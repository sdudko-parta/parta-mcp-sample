---
name: parta-sync
description: Push a local project directory (project.json + pages/ + assets/) into Parta via the Parta MCP. On first run creates the project; on subsequent runs syncs only the delta against the recorded .sync.json state.
---

# parta-sync

Sync a local course directory in this repo to a Parta project. The local files are the source of truth; Parta is the destination.

## Invocation

The user invokes the skill with the path of the course directory:

```text
/parta-sync mcp-server-project
/parta-sync productive-work-with-ai-agents
/parta-sync sample-project-1
```

If no argument is given, ask the user which directory to sync. Only directories that contain a `project.json` are valid.

## Inputs you read

| Path                                  | Role                                                                                               |
|---------------------------------------|----------------------------------------------------------------------------------------------------|
| `<dir>/project.json`                  | Course shell. Validated against `schema.json` at the repo root before any MCP call.                |
| `<dir>/pages/*.md`                    | One markdown file per page. Referenced from `project.json#/pages[*].ref`.                          |
| `<dir>/assets/*`                      | Binary assets referenced from pages by relative path (`![alt](../assets/foo.png)`).                |
| `<dir>/.sync.json`                    | (Optional) state from the previous successful sync. Drives the delta. Absent on first run.         |

## State you write back

After a successful sync, write `<dir>/.sync.json`:

```jsonc
{
  "lastSyncedAt": "2026-05-05T12:34:56.000Z",
  "remote": {
    "companyId": "cmp_…",
    "projectId": "prj_…",
    "rootDirectoryId": "dir_…"
  },
  "pages": {
    "pages/01-welcome.md": {
      "sectionId": "sec_…",
      "blockUuid": "blk_…",
      "templateId": "tpl_…",
      "sha256": "<hex hash of the markdown source>"
    }
  },
  "assets": {
    "assets/cover.png": {
      "fileId": "file_…",
      "sha256": "<hex hash>",
      "size": 1234
    }
  }
}
```

If you also write project-level identity back, update `project.json#/id` and `project.json#/companyId` so the next run finds them without `.sync.json`.

## Algorithm

### 1. Validate

1. Read `project.json`. Reject if it doesn't satisfy `schema.json` (especially `pages[*].ref` matches `^pages/.+\.md$`).
2. Confirm every `pages[*].ref` exists on disk. Abort with a clear message if a referenced page is missing.

### 2. Resolve company and project

- If `.sync.json` exists and `remote.projectId` is set, use it. Verify the project still exists with `list_editor_projects` for the recorded company. If it's gone, treat as a fresh sync (drop `.sync.json` from memory; do not delete the file yet).
- Else if `project.json#/id` is set, treat that as the project id; verify the same way.
- Else (no recorded id):
  - If `project.json#/companyId` is null, call `list_companies` and ask the user to pick one.
  - Call `create_editor_project` with the resolved company and `project.json#/name`.
  - Write the new id into `project.json` and into the in-memory `.sync.json`.

### 3. Compute the local desired state

For each entry in `project.json#/pages`, in order:

- `name`, `description`, `ref` from the entry.
- `sha256` of the file at `ref`.
- The list of asset paths the page references (parse markdown image and link nodes; resolve relative to the page).

Collect the set of all referenced assets across pages. Hash each asset file.

### 4. Sync assets first

Reason: a page's content references asset `fileId`s. Upload before block updates.

For each referenced asset path:

1. If `.sync.json.assets[path]` exists and the hash matches, reuse `fileId`. Skip.
2. Else, upload:
   - Local files → `create_s3_uploads` (batch up to 50), PUT each part to the returned signed URL, capture per-part ETags, then `complete_s3_uploads`. On any per-file failure, fall back to `cancel_s3_uploads` for the orphans before retrying.
   - Public http(s) URLs (if a page links to one in markdown image syntax) → `upload_file_from_url`.
3. Record the new `fileId`, `sha256`, and `size` in the in-memory `.sync.json.assets[path]`.

Don't delete unreferenced assets server-side automatically. Print a list of "no longer referenced" asset ids at the end; the user can clean them up manually.

### 5. Pick (or reuse) the page template

Once per sync:

1. If `.sync.json` already records a `templateId` per page, reuse it.
2. Else: `list_editor_template_groups` → find the **Parta Quick-Start Collection** → `list_editor_templates` → pick a template suitable for a richText page (one with a `richText` slot in its `bankContentSchema`). Cache the chosen `templateId` for the rest of the run.

### 6. Diff and apply pages

Build two ordered lists:

- `desired = project.json#/pages` (by `ref`).
- `current = .sync.json.pages` keys, ordered by their original `sectionId` position.

Walk the diff:

| Case                                                       | Action                                                                                                                           |
|------------------------------------------------------------|----------------------------------------------------------------------------------------------------------------------------------|
| `ref` in desired, not in current                           | `create_editor_section` (type=`landing`, position=desired index), `create_editor_block` (templateId), `update_editor_block` with rendered content. |
| `ref` in current, not in desired                           | `delete_editor_section` for the recorded `sectionId`.                                                                            |
| `ref` in both, hash changed                                | `get_editor_block` (for current schema), `update_editor_block` with re-rendered content.                                         |
| `ref` in both, position differs                            | `move_editor_section` to the new index.                                                                                          |
| `ref` in both, hash same, position same                    | Skip.                                                                                                                            |
| `name` in `project.json` differs from current section name | `update_editor_section` with the new name. (Cheap; always do it when the hash already changed too.)                              |

Apply deletes first (they shift indices), then creates (in target order), then moves, then updates.

Batch where the API supports it: `create_editor_sections` for first-run creates; `update_editor_blocks` (≤50) for content fills.

### 7. Render markdown → `bankContentItems`

The skill is responsible for converting each page's markdown into the block's content schema:

1. `get_editor_block` for the target block to read its `bankContentSchema` — it's the source of truth for keys and types.
2. Walk the markdown AST:
   - Headings, paragraphs, lists, inline emphasis → one `richText` slot containing HTML (`<h1>…<p>…<strong>`).
   - Image references (`![alt](../assets/foo.png)`) → an `image` slot with `{ source: "file", fileId: <from step 4>, alt, zoomable: false, overlay: null }`. If the block schema has only one richText slot, fall back to inlining `<img>` in the richText with the file's public URL (call `get_file_url` once per fileId).
   - Code blocks → `code` slot if available; else fenced `<pre><code>` inside richText.
3. Build `bankContentItems` using **only** keys present in the retrieved schema. Do not invent keys.
4. Call `update_editor_block` (or `update_editor_blocks` for batched first-run fills). Inspect `validation.errors` and retry only the offending items.

### 8. Update project metadata

If `project.json#/name` changed, call `update_editor_project`. Description is rendered into the cover block (when a cover exists) — currently we model pages as flat landings, so `description` is informational only and does not need an MCP call.

### 9. Persist `.sync.json`

Only on full success. Write the in-memory state to `<dir>/.sync.json`. Update `project.json#/id` and `project.json#/companyId` if they were null.

## Error handling

- Any MCP call fails → stop, report which step failed, do **not** write `.sync.json`. The next run sees the same starting state and can retry idempotently.
- Asset upload partially fails → call `cancel_s3_uploads` for the orphan sessions before exiting.
- Schema validation fails on a `bankContentItems` payload → log the offending keys and continue with the rest of the items. The user can re-run after fixing the page.
- The user interrupts mid-run → the operations applied so far are durable in Parta; `.sync.json` will not be updated, so the next run picks up where we left off.

## Output to the user

End the run with a short summary:

```text
Synced productive-work-with-ai-agents → Parta
  project: prj_abc (https://app.parta.io/...)
  +  3 pages created
  ~  1 page updated
  ↕  2 pages reordered
  -  0 pages deleted
  +  4 assets uploaded
  ~  1 asset re-uploaded
  unreferenced server assets: 2 (file_…, file_…)
```

Always include the project URL via `get_project_link` so the user can open the result in one click.

## Future hooks (do not implement now)

- **Mirror to GitHub** — after a successful Parta sync, also push the changed files via the GitHub MCP `push_files`.
- **Schedule** — call this skill on a cron via the `schedule` skill so the sync runs hands-off.
- **Reverse sync** — pull from Parta into markdown so editor changes flow back. Requires resolving conflicts; out of scope for v1.
