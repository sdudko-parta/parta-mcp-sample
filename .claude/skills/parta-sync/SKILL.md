---
name: parta-sync
description: Sync the Parta course projects in the sdudko-parta/parta-mcp-sample GitHub repository (project.json + pages/*.md + assets/*) into Parta via the Parta MCP. The skill talks to GitHub through the GitHub MCP only — no local clone, no helper scripts, no Node setup. The first run creates the project, sections and blocks from the "Parta Quick-Start Collection" template group; subsequent runs apply only the delta against the recorded .sync.json. Run interactively with `/parta-sync <dir>` or on a cron via the `schedule` skill.
---

# parta-sync

GitHub is the source of truth; Parta is the destination. Both are reached only through MCPs — there is no working tree to walk. **Markdown content is not rewritten.** The skill parses each page in-context, places each AST node into the most appropriate template from the **Parta Quick-Start Collection** group (the exact name returned by `list_editor_template_groups`), and persists what was synced as a per-course `.sync.json` committed back to this repo.

## Repository

- Owner: `sdudko-parta`
- Repo: `parta-mcp-sample`
- Default branch: `main`
- Public — raw URLs (`https://raw.githubusercontent.com/sdudko-parta/parta-mcp-sample/main/<path>`) work without auth.

If the user invokes the skill against a different repo, ask once at the start of the run and use the answer for every GitHub MCP call below.

## Invocation

```text
/parta-sync mcp-server-project
/parta-sync productive-work-with-ai-agents
/parta-sync sample-project-1
```

If invoked without an argument, ask the user which directory to sync. Only directories that contain a `project.json` at the repo root are valid.

For scheduled runs the same command is used. The scheduler does not need a working directory and must not run `git pull` or any other shell setup — every read and write goes through MCPs.

## Inputs (read via GitHub MCP)

| Path                  | How to read                                                          | Role                                                                                                                                  |
|-----------------------|----------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| `schema.json`         | `get_file_contents(owner=sdudko-parta, repo=parta-mcp-sample, path=schema.json)` | JSON Schema for `project.json`. Validate `project.json` locally before any Parta call.                                  |
| `<dir>/project.json`  | `get_file_contents(owner=sdudko-parta, repo=parta-mcp-sample, path=<dir>/project.json)` | Course shell. Capture the file's git blob `sha` from the response — needed when writing back at §10.          |
| `<dir>/pages/<file>.md` | `get_file_contents(owner=sdudko-parta, repo=parta-mcp-sample, path=<dir>/pages/<file>.md)` | One markdown file per page; referenced from `project.json#/pages[*].ref`. Capture each file's blob `sha`.  |
| `<dir>/assets`        | `get_file_contents(owner=sdudko-parta, repo=parta-mcp-sample, path=<dir>/assets)` (returns directory listing) | Each entry has the asset's git blob `sha` and `size`. This is the asset inventory.              |
| `<dir>/.sync.json`    | `get_file_contents(owner=sdudko-parta, repo=parta-mcp-sample, path=<dir>/.sync.json)` | (Optional) state from the previous successful sync. Drives the delta. A 404 means first run — do not treat as an error. |

The git blob `sha` returned by GitHub for each file is content-addressed and stable — use it directly as the change-detection key. Don't compute sha256 yourself; you have no local file to hash.

## State persisted (written via GitHub MCP)

After a successful sync, write `<dir>/.sync.json` to the **course repo** (`sdudko-parta/parta-mcp-sample`) via `create_or_update_file`. Commit message: `parta-sync state: <dir>`.

```jsonc
{
  "lastSyncedAt": "2026-05-05T12:34:56.000Z",
  "projectJsonBlobSha": "<git blob sha of project.json at last sync>",
  "remote": {
    "companyId": "cmp_…",
    "projectId": "prj_…"
  },
  "templateGroup": {
    "id": "grp_…",
    "name": "Parta Quick-Start Collection"
  },
  "templates": {
    "Heading 1": "tpl_…",
    "Heading 2 with Caption": "tpl_…",
    "Text": "tpl_…",
    "Bullet List": "tpl_…",
    "Numbered List": "tpl_…",
    "Code Snippet": "tpl_…",
    "Image with Caption": "tpl_…",
    "Text with Image (Right)": "tpl_…",
    "Quote 4": "tpl_…",
    "Statement 1": "tpl_…",
    "Table": "tpl_…",
    "Embed Code": "tpl_…",
    "Line Divider": "tpl_…",
    "Cover 4": "tpl_…",
    "Continue Button": "tpl_…",
    "Footer 1": "tpl_…"
  },
  "pages": {
    "pages/01-welcome.md": {
      "sectionId": "sec_…",
      "blobSha": "<git blob sha at last sync>",
      "blocks": [
        { "uuid": "blk_…", "templateName": "Heading 1 with Caption", "nodeKey": "h1#0" },
        { "uuid": "blk_…", "templateName": "Image with Caption",     "nodeKey": "image#0" },
        { "uuid": "blk_…", "templateName": "Heading 2",              "nodeKey": "h2#0" },
        { "uuid": "blk_…", "templateName": "Text",                   "nodeKey": "p#0" }
      ]
    }
  },
  "assets": {
    "assets/01-welcome.png": {
      "fileMetaId": "fm_…",
      "blobSha": "<git blob sha>",
      "size": 15421
    }
  }
}
```

On the **first** successful sync also write the resolved `id` and `companyId` back into `<dir>/project.json` in the course repo via a separate `create_or_update_file`. Commit message: `parta-sync init: <dir>`. Subsequent syncs do not touch `project.json`.

## Algorithm

### 0. Manifest short-circuit

The most common case on a cron run is "nothing changed." Fail fast before any parsing, schema validation, or template work.

In a single batch (parallel `get_file_contents` calls):

1. `<dir>/project.json` — capture body and blob `sha`.
2. `<dir>/pages` — directory listing; capture each page path and blob `sha`.
3. `<dir>/assets` — directory listing; capture each asset path, blob `sha`, and `size`.
4. `<dir>/.sync.json` — previous state. 404 → first run; skip the comparison and fall through to §1, reusing the data above.

If `.sync.json` exists, compare four things against the recorded slice:

- `projectJsonBlobSha` matches the current `project.json` blob `sha`.
- The ordered list of `pages[*].ref` in the current `project.json` matches the keys in `.sync.json.pages` in the same order.
- For every page, the current blob `sha` matches `.sync.json.pages[ref].blobSha`.
- The set of asset paths is identical, and every asset's blob `sha` matches `.sync.json.assets[path].blobSha`.

All four match → exit with "no changes": print the summary using the recorded `projectId` and zero counts. Do **not** call any Parta MCP. Do **not** rewrite `.sync.json`.

Any mismatch → fall through to §1, **reusing the data already fetched** (don't re-fetch `project.json`, the page listing, the assets listing, or `.sync.json`).

### 1. Validate

1. `get_file_contents(repo=parta-mcp-sample, path=schema.json)` → parse the JSON Schema once.
2. Validate `project.json` (already fetched in §0) against the schema, especially `pages[*].ref` matches `^pages/.+\.md$`.
3. Fetch every `<dir>/<ref>` from `pages[*].ref` **in parallel** via `get_file_contents`. A 404 on any of them aborts the run with a message naming the missing page. Capture each file's blob `sha`.

### 2. Resolve company and project

- If `<dir>/.sync.json` exists in the course repo and records `remote.projectId`, verify the project still exists with `list_editor_projects`. If gone, treat as a fresh sync (drop the in-memory state; do not delete `.sync.json` yet).
- Else if `project.json#/id` is set, treat that as the project id and verify the same way.
- Else (no recorded id):
  - If `project.json#/companyId === null`, call `list_companies` and ask the user to pick one.
  - Call `create_editor_project` with the resolved company and `project.json#/name`.
  - Buffer the new id in memory; persist back to `project.json` only at §10.

### 3. Resolve the template group and template ids

Once per sync:

1. `list_editor_template_groups` for the company. Pick the group whose name is exactly `Parta Quick-Start Collection` (`get_template_choice_defaults` confirms the default).
2. `list_editor_templates` for that group. Build a `templateName → templateId` map.
3. For every template name referenced in §8 call `get_editor_block_by_template_id` once and cache the `bankContentSchema`. That schema is the source of truth for content keys.

If `.sync.json` already records `templates[name] → templateId`, reuse them and skip discovery.

### 4. Build the desired state

For each entry in `project.json#/pages`, in order:

1. From the page contents fetched in §1, capture the markdown body and the file's git blob `sha`.
2. Parse the markdown in-context: walk the AST node by node, applying the mapping table in §8. Produce an ordered block plan `[{ nodeKey, templateName, payload }]`.
   - `nodeKey` = `<type>#<index>` where the index is per-type within this page (`h1#0`, `h2#0`, `h2#1`, `p#0`, `image#0`, `code#0`, …). It is stable across re-runs unless the markdown structure itself changes.
   - `templateName` comes from the table; resolve variants per the variety rule below.
   - `payload` carries the rendered HTML for richText slots, the asset reference for image/video/audio slots, and the raw fields for code/table slots.
3. Collect every asset reference found in the page (`![alt](../assets/foo.png)`, link nodes that point at downloadable types). Resolve to a repo-relative path (`<dir>/assets/foo.png`).

After all pages have been parsed, the `<dir>/assets` directory listing fetched in §1 is the master asset inventory — each entry has `path`, `sha`, `size`.

### 5. Sync assets first

A page block can only embed an uploaded file by `fileMetaId`. The asset stream and the page stream are independent: assets are reconciled first, then pages pull the current `path → fileMetaId` map at write time. This is what lets a pure asset swap (image bytes change, markdown unchanged) still propagate into Parta.

Asset uploads are independent — issue `upload_file_from_url` calls **in parallel** across paths. The only ordering constraint is that all of §5 must finish before §7 starts writing block content.

For each asset referenced by at least one page:

1. If `.sync.json.assets[path]` exists and the recorded `blobSha` matches the current one from the directory listing, reuse `fileMetaId`. Skip upload.
2. Otherwise call `upload_file_from_url` with `https://raw.githubusercontent.com/sdudko-parta/parta-mcp-sample/main/<path>`. Capture the returned `fileMetaId`.
3. If the path previously had a different `fileMetaId`, buffer the old id in `replacedFileMetaIds[]`. It will be deleted at the end of §10, after every block referencing it has been rebound to the new id.
4. Record the new `fileMetaId`, `blobSha`, `size` in the in-memory `.sync.json.assets[path]`.

Build `changedAssetPaths` — the set of asset paths whose `fileMetaId` is new in this run (uploads in step 2, including first uploads and replacements). §6 uses it to mark pages that need their blocks rebound even when the page's own markdown blob hasn't changed.

Assets that are orphaned because the **path was removed from the repo** are NOT auto-deleted. Print them at the end of the run; the user decides. (Replacements at the same path are auto-cleaned via `replacedFileMetaIds` — different case, safe to delete because §7 has already rebound the references.)

### 6. Section-level diff

Build two ordered lists:

- `desired` — `project.json#/pages` keyed by `ref`.
- `current` — `.sync.json.pages` keys, ordered by recorded section position.

| Case                                                            | Action                                                                                                                                                                                                                                  |
|-----------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `ref` in desired, not in current                                | `create_editor_section` (type=`cover` for `pages[0]`, otherwise `landing`; position=desired index) → series of `create_editor_block` per the parsed plan → series of `update_editor_block` to fill content.                              |
| `ref` in current, not in desired                                | `delete_editor_section` for the recorded `sectionId`.                                                                                                                                                                                   |
| `ref` in both, page `blobSha` changed                           | Re-parse the new markdown. Diff the new plan against recorded `blocks[]` by `nodeKey` and `templateName`. Apply the delta: add missing blocks, delete extra ones, update content via `update_editor_block` (batch as `update_editor_blocks` where possible), `move_editor_block` if order changed. |
| `ref` in both, page references at least one path in `changedAssetPaths` (markdown otherwise unchanged) | Re-emit content for blocks whose payload references an affected asset (image / video / audio / downloader slots). Use the latest `fileMetaId` from §5's map. No re-parse needed beyond locating those blocks via recorded `nodeKey`s. |
| `ref` in both, position differs                                 | `move_editor_section` to the new index.                                                                                                                                                                                                 |
| `ref` in both, no markdown change, no asset rebind, no position change | Skip.                                                                                                                                                                                                                            |
| `name` in `project.json` differs from the recorded section name | `update_editor_section` with the new name.                                                                                                                                                                                              |

Apply order: deletes → creates (in target order) → moves → content updates. This avoids index churn.

**Parallelism.** Operations on **different `sectionId`s are independent** — fan them out: parallel `delete_editor_section`, parallel `create_editor_section` (after the deletes resolve, since target indices are computed against the deleted-removed list), parallel `move_editor_section`, parallel content fills across sections. **Within a single section**, keep block-level operations strictly sequential (`create_editor_block`, `update_editor_block`/`update_editor_blocks`, `move_editor_block`, `delete_editor_block`): Parta treats the section as a transactional unit, and concurrent block writes against the same `sectionId` will reject or interleave incorrectly. Batched `update_editor_blocks` (≤ 50) is one MCP call covering many blocks of one section — that's still one transaction and is the preferred form.

### 7. Block-level fill: parsed payload → `bankContentItems`

For each planned block:

1. Read the cached schema for `templateName` (from §3).
2. Translate the parsed payload to `bankContentItems` keyed strictly by the schema:
   - `richText` slot ← minimal HTML for the node (`<h1>`/`<h2>`/`<p>`/`<strong>`/`<em>`/`<code>`/`<a>`/`<ul>`/`<ol>`).
   - `image` slot ← `{ source: "file", fileMetaId, alt, zoomable: false, overlay: null }`. The `fileMetaId` comes from §5. **Never** inline an `<img src=…>` to a relative repo path or to a `raw.githubusercontent.com` URL; if the chosen template has no `image` slot, downgrade to the next template in the §8 family that does (this is the only place the skill overrides the parser's `templateName`).
   - `code` slot ← `{ language, code }` from the fenced block (`language` from the info string; default `text`).
   - `table` slot ← `{ header, rows }` from the GFM table; do not transform cells.
   - `caption`, `heading`, `label`, `url` ← copy from the parsed payload by name.
3. Build `bankContentItems` using **only** keys present in the cached schema. Do not invent keys.
4. Call `update_editor_block` (or batch `update_editor_blocks`, ≤ 50). Inspect `validation.errors`; retry only the offending entries.

### 8. Cheat-sheet: markdown node → Quick-Start template

| Markdown node                                                                              | Default template               | Variants in the same family for visual variety                                                  |
|--------------------------------------------------------------------------------------------|--------------------------------|-------------------------------------------------------------------------------------------------|
| H1 + immediate paragraph                                                                   | `Heading 1 with Caption`       | `Heading 1` if no lead paragraph                                                                |
| H2 (rotate)                                                                                | `Heading 2`                    | `Heading 2 with Caption`, `Heading 2 with Divider`, `Heading 2 with Icon`                       |
| H3                                                                                         | `Heading 3`                    | `Heading 3 with Icon`                                                                           |
| Plain paragraph                                                                            | `Text`                         | —                                                                                               |
| Paragraph followed by a single-image paragraph                                             | `Text with Image (Right)`      | `Text with Image (Left)`, `Image with Text Block`, `Text Block with Image`                      |
| Standalone image (no caption)                                                              | `Image`                        | `Big Image`, `Image (Full Screen)`                                                              |
| Standalone image with alt text                                                             | `Image with Caption`           | —                                                                                               |
| GFM bullet list                                                                            | `Bullet List`                  | `Icon List`, `Two column Icon List`                                                             |
| GFM ordered list                                                                           | `Numbered List`                | —                                                                                               |
| Fenced code block                                                                          | `Code Snippet`                 | —                                                                                               |
| Blockquote without attribution                                                             | `Statement 1`                  | `Statement 4` (with leading H3)                                                                 |
| Blockquote with `— Author` attribution                                                     | `Quote 4`                      | `Quote 1` / `Quote 2` if `assets/authors/<slug>.png` exists                                     |
| GFM table                                                                                  | `Table`                        | —                                                                                               |
| Inline HTML / `<iframe>` / `<embed>`                                                       | `Embed Code`                   | —                                                                                               |
| Standalone link paragraph                                                                  | `Link`                         | `Button with Heading and Description` (with leading short heading)                              |
| Standalone link to a downloadable (`.pdf` / `.zip` / `.csv` / `.xlsx` / `.docx` / `.pptx`) | `Downloader`                   | `Downloader with Caption` (caption from link title)                                             |
| Horizontal rule (rotate)                                                                   | `Line Divider`                 | `Color Divider`, `Numbered Divider`, `Double Divider`                                           |
| YouTube/Vimeo URL                                                                          | `Video with Caption`           | `Video`, `Video with Transcript` (if `<page>.transcript.md` exists)                             |
| Audio file                                                                                 | `Audio with Caption`           | `Audio`                                                                                         |

**Cover for `pages[0]`:** the section type is `cover` and contains exactly one block; default template is `Cover 4` (compact: author card + course structure + start button). Alternatives: `Cover 1` (full, with progress bar), `Cover 6` (minimal). Choose by what is actually present in `project.json` and the first page (author photo? hero image?).

**Final-page footer:** append a closing `Footer 1` (or `Footer 2` if there is branding/copyright data in `project.json`) to the last page.

**Variety rule:** within one page, do not use the same `templateName` more than twice in a row. Rotate within the same family from the table. The H2 rotation order is `Heading 2 → Heading 2 with Caption → Heading 2 with Divider → Heading 2 with Icon`; the divider rotation is `Line Divider → Color Divider → Numbered Divider → Double Divider`.

**Do not invent ids.** `bankContentItems` keys come **only** from the cached `bankContentSchema` of the chosen template. If a key is missing, downgrade to the closest compatible template in the same row of the table.

### 9. Project metadata

- If `project.json#/name` changed, call `update_editor_project`.
- If `project.json#/description` changed and the course has a Cover block, update the Cover block's description field — there is no separate project-level description endpoint.

### 10. Persist `.sync.json`, project ids, and clean up replaced assets

Only on full success — i.e., §7 finished without leaving any block pointing at a stale `fileMetaId`.

1. For each id in `replacedFileMetaIds` (collected in §5), call `delete_file(fileMetaId=<old>)` **in parallel**. A failure here is logged but does not abort the run — by this point all blocks already point at the new asset, so the orphan is harmless. **Order matters:** never delete before §7 completes; otherwise a transient block would reference a missing file.
2. Build the new `<dir>/.sync.json` payload (must include the top-level `projectJsonBlobSha` — recompute it from the body that will actually be written in step 3 if this is a first sync, otherwise reuse the blob `sha` captured in §0).
3. Commit:
   - **First sync** (`project.json#/id` was null on entry): bundle `<dir>/project.json` (with resolved `id` and `companyId`) and `<dir>/.sync.json` into a **single commit** via the GitHub MCP's multi-file commit (`push_files` or equivalent). Commit message: `parta-sync init: <dir>`. After the commit, refresh the `.sync.json.projectJsonBlobSha` field if `push_files` returned new blob shas; if the GitHub MCP exposes them only via a follow-up `get_file_contents`, do that and patch the field with one extra `create_or_update_file` (cost: one extra commit on first-sync only — acceptable since first syncs are rare). If `push_files` is unavailable in the GitHub MCP, fall back to two `create_or_update_file` calls in order — `project.json` first, then `.sync.json` (whose `projectJsonBlobSha` references the just-committed body).
   - **Subsequent sync**: write only `<dir>/.sync.json` via `create_or_update_file` (pass its `sha` captured in §0). Commit message: `parta-sync state: <dir>`.

On a multi-course run, expect one commit per course on the steady state. First syncs add at most one extra commit per course if the multi-file commit path isn't available.

## Error handling

- Any MCP call fails → stop, report which step failed, do **not** persist `.sync.json`. The next run sees the same starting state and retries idempotently.
- Asset upload fails (`upload_file_from_url` non-2xx) → stop, name the asset, exit.
- `bankContentItems` validation fails on one item → log the offending key, skip that block, continue the batch. Re-running after a fix is safe.
- The user interrupts mid-run → operations applied to Parta so far are durable; `.sync.json` was not committed, so the next run resumes from a consistent state.
- A `create_or_update_file` 409 on `.sync.json` (someone else committed in between) → re-fetch the file's `sha` from the course repo, rebuild the payload from current Parta state, retry once. If it still 409s, report and stop.

## Output

End with a one-block summary per project:

```text
Sync productive-work-with-ai-agents → Parta
  project: prj_abc (https://app.parta.io/...)
  +  3 pages created (32 blocks)
  ~  1 page updated (4 blocks changed)
  ↕  2 pages reordered
  -  0 pages deleted
  +  4 assets uploaded
  ~  1 asset re-uploaded (1 old fileMetaId deleted, 3 blocks rebound)
  unreferenced server assets: 2 (fm_…, fm_…)
  state commit: <sha>
```

Always include the project URL via `get_project_link`.

When §0 short-circuits (manifest match, no Parta calls made), still print the same block — just with all counters at zero and a `manifest match — no Parta calls` line in place of `state commit`. This keeps cron logs readable without misleading anyone into thinking the run was skipped entirely.

## What NOT to do

- Do not invent `bankContentItems` keys — downgrade to the next compatible template in §8 instead.
- Do not edit `.sync.json` by hand. Do not edit `id` or `companyId` in `project.json` after the first successful sync.
- Do not push raw image URLs (`raw.githubusercontent.com/...`) into block content. Always go through `fileMetaId`.
- Do not assume any local working tree, `npm install`, or `git pull`. Everything is MCP-only.
- Do not implement the reverse direction (Parta → markdown). Out of scope.

## Future hooks (not for v1)

- **Bidirectional sync** — pull from Parta into markdown with conflict resolution.
- **Multiple repos / multiple branches** — current skill is hard-bound to `sdudko-parta/parta-mcp-sample` `main`. Parametrize when needed.
