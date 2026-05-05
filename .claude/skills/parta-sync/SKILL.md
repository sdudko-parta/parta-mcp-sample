---
name: parta-sync
description: Sync a local course directory (project.json + pages/*.md + assets/*) into a Parta project via the Parta MCP. The first run creates the project, sections and blocks from the "Parta Quick-Start Collection" template group; subsequent runs apply only the delta against the recorded .sync.json. Run interactively with `/parta-sync <dir>` or on a cron via the `schedule` skill.
---

# parta-sync

Local files are the source of truth; Parta is the destination. **The skill does not rewrite content.** It cuts the markdown into AST nodes and places each one into the most appropriate template from the **Parta Quick-Start Collection** template group (the exact name returned by `list_editor_template_groups`).

## Invocation

```text
/parta-sync mcp-server-project
/parta-sync productive-work-with-ai-agents
/parta-sync sample-project-1
```

If invoked without an argument, ask the user which directory to sync. Only directories that contain a `project.json` are valid.

For scheduled runs, use the `schedule` skill with the same command — there should be no separate logic on the scheduler side.

## Helper scripts

This skill ships two Node helpers in `scripts/`. Install once:

```text
npm install --prefix .claude/skills/parta-sync
```

| Script                                | Purpose                                                                                                                                                                                                                                                |
|---------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `scripts/parse-page.mjs <page.md>`    | Parse a markdown page into a deterministic block plan. Emits JSON: `{ source, assets, blocks: [{ nodeKey, templateName, payload }] }`. The skill consumes `assets` for upload and `blocks` for the create/update sequence.                              |
| `scripts/upload-asset.mjs`            | Read a JSON instruction on stdin and PUT each S3 multipart part to its pre-signed URL with retry. Emits `{ etags: [{ partNumber, etag }] }` on stdout — the payload `complete_s3_uploads` expects.                                                      |

The scripts are content-aware but Parta-unaware: they never call MCP. The skill orchestrates; the scripts do the deterministic, schema-free work (markdown parsing, HTTP PUT).

## Inputs

| Path                  | Role                                                                                       |
|-----------------------|--------------------------------------------------------------------------------------------|
| `<dir>/project.json`  | Course shell. Validated against `schema.json` at the repo root before any MCP call.        |
| `<dir>/pages/*.md`    | One markdown file per page, referenced from `project.json#/pages[*].ref`.                  |
| `<dir>/assets/*`      | Binary assets referenced from pages (`![alt](../assets/foo.png)`).                         |
| `<dir>/.sync.json`    | (Optional) state from the previous successful sync. Drives the delta.                      |

## State written back

On full success, write `<dir>/.sync.json`:

```jsonc
{
  "lastSyncedAt": "2026-05-05T12:34:56.000Z",
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
      "sha256": "<hex>",
      "blocks": [
        { "uuid": "blk_…", "templateName": "Heading 1 with Caption", "nodeKey": "h1#0" },
        { "uuid": "blk_…", "templateName": "Image with Caption",     "nodeKey": "image#0" },
        { "uuid": "blk_…", "templateName": "Heading 2",              "nodeKey": "h2#0" },
        { "uuid": "blk_…", "templateName": "Text",                   "nodeKey": "p#0" }
      ]
    }
  },
  "assets": {
    "mcp-server-project/assets/01-welcome.png": {
      "fileMetaId": "fm_…",
      "sha256": "<hex>",
      "size": 15421
    }
  }
}
```

On the first successful sync, also write `id` and `companyId` back into `project.json`.

## Algorithm

### 1. Validate

1. Read `project.json`. Reject if it does not satisfy `schema.json` (especially `pages[*].ref` must match `^pages/.+\.md$`).
2. Confirm every `pages[*].ref` exists on disk.

### 2. Resolve company and project

- If `.sync.json` records `remote.projectId`, verify the project still exists with `list_editor_projects`. If it is gone, treat as a fresh sync (drop `.sync.json` from memory; do not delete the file yet).
- Else if `project.json#/id` is set, treat that as the project id and verify the same way.
- Else (no recorded id):
  - If `project.json#/companyId === null`, call `list_companies` and ask the user to pick one.
  - Call `create_editor_project` with the resolved company and `project.json#/name`.
  - Record the new id in memory; only persist to `project.json` at the end of a successful sync.

### 3. Resolve the template group and template ids

Once per sync:

1. `list_editor_template_groups` for the company. Pick the group whose name is exactly `Parta Quick-Start Collection` (`get_template_choice_defaults` confirms this is the default).
2. `list_editor_templates` for that group. Build a `templateName → templateId` map.
3. For every template name referenced in §8 call `get_editor_block_by_template_id` once and cache the `bankContentSchema`. That schema is the source of truth for content keys.

If `.sync.json` already has cached `templateId`s, reuse them.

### 4. Build the desired state

For each entry in `project.json#/pages`, in order:

1. Capture `name`, `description`, `ref`.
2. Compute `sha256(file)`.
3. Run `node scripts/parse-page.mjs <ref>`. Parse the resulting JSON. The `blocks` array is the per-page plan: ordered list of `{ nodeKey, templateName, payload }`. The `assets` array is the set of repo-relative asset paths the page references.

Collect the union of all assets across pages. Compute `sha256(file)` for each.

### 5. Sync assets first

A page block can only embed an uploaded file by `fileMetaId`. Upload before block content writes.

For each asset:

1. If `.sync.json.assets[path]` exists and `sha256` matches, reuse `fileMetaId`. Skip upload.
2. Otherwise:
   - Local files → call `create_s3_uploads` (batch up to 50). For each returned upload, pipe `{ filePath, parts: [...] }` into `node scripts/upload-asset.mjs` to PUT each part with retry; capture `etags` from stdout. Then call `complete_s3_uploads` with the etags. On any per-file failure, call `cancel_s3_uploads` for the orphans before retrying.
   - External `https://` images referenced from markdown → `upload_file_from_url`.
3. Record `fileMetaId`, `sha256`, `size` in the in-memory `.sync.json.assets[path]`.

Server-side assets that are no longer referenced are NOT auto-deleted. Print them at the end of the run; the user cleans them up manually.

### 6. Section-level diff

Build two ordered lists:

- `desired` — `project.json#/pages` keyed by `ref`.
- `current` — `.sync.json.pages` keys, ordered by their recorded `sectionId` position.

| Case                                                            | Action                                                                                                                                                                                                                                  |
|-----------------------------------------------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `ref` in desired, not in current                                | `create_editor_section` (type=`cover` for `pages[0]`, otherwise `landing`; position=desired index) → series of `create_editor_block` per the parser plan → series of `update_editor_block` to fill content.                              |
| `ref` in current, not in desired                                | `delete_editor_section` for the recorded `sectionId`.                                                                                                                                                                                   |
| `ref` in both, page `sha256` changed                            | Re-parse with `parse-page.mjs`. Diff the new plan against the recorded `blocks[]` by `nodeKey` and `templateName`. Apply the delta: add missing blocks, delete extra ones, update content via `update_editor_block` (batch as `update_editor_blocks` where possible), `move_editor_block` if order changed. |
| `ref` in both, position differs                                 | `move_editor_section` to the new index.                                                                                                                                                                                                 |
| `ref` in both, no content change, no position change            | Skip.                                                                                                                                                                                                                                   |
| `name` in `project.json` differs from the recorded section name | `update_editor_section` with the new name.                                                                                                                                                                                              |

Apply order: deletes → creates (in target order) → moves → content updates. This avoids index churn.

### 7. Block-level fill: parser payload → `bankContentItems`

For each planned block:

1. Read the cached schema for `templateName` (from §3).
2. Translate the parser's `payload` to `bankContentItems` keyed strictly by the schema:
   - `richText` slot ← the HTML produced by the parser (`<h1>`/`<h2>`/`<p>`/`<strong>`/`<em>`/`<code>`/`<a>`/`<ul>`/`<ol>`).
   - `image` slot ← `{ source: "file", fileMetaId, alt, zoomable: false, overlay: null }`. The `fileMetaId` comes from the asset map populated in §5. **Never** inline an `<img src=…>` to a relative repo path or a raw S3 URL; if the chosen template has no `image` slot, downgrade to the next template in the §8 family that does (this is the only place where the skill overrides the parser's `templateName`).
   - `code` slot ← `{ language, code }` from the parser payload.
   - `table` slot ← `{ header, rows }` from the parser payload, no cell transformation.
   - `caption`, `heading`, `label`, `url` ← copy from the parser payload by name.
3. Build `bankContentItems` using **only** keys present in the cached schema. Do not invent keys.
4. Call `update_editor_block` (or batch `update_editor_blocks`, ≤ 50). Inspect `validation.errors`; retry only the offending entries.

### 8. Cheat-sheet: markdown node → Quick-Start template

The parser already emits `templateName` per node. This is the table it uses; keep it here so SKILL.md and the parser stay in sync. If you extend it, edit both.

| Markdown node                                                                              | Default template               | Variants in the same family for visual variety                                                  |
|--------------------------------------------------------------------------------------------|--------------------------------|-------------------------------------------------------------------------------------------------|
| H1 + immediate paragraph                                                                   | `Heading 1 with Caption`       | `Heading 1` if no lead paragraph                                                                |
| H2 (rotated)                                                                               | `Heading 2`                    | `Heading 2 with Caption`, `Heading 2 with Divider`, `Heading 2 with Icon`                       |
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
| Standalone link paragraph                                                                  | `Link`                         | `Button with Heading and Description` (if a leading short heading exists)                       |
| Standalone link to a downloadable (`.pdf` / `.zip` / `.csv` / `.xlsx` / `.docx` / `.pptx`) | `Downloader`                   | `Downloader with Caption` (caption from link title)                                             |
| Horizontal rule (rotated)                                                                  | `Line Divider`                 | `Color Divider`, `Numbered Divider`, `Double Divider`                                           |
| YouTube/Vimeo URL                                                                          | `Video with Caption`           | `Video`, `Video with Transcript` (if `<page>.transcript.md` exists)                             |
| Audio file                                                                                 | `Audio with Caption`           | `Audio`                                                                                         |

**Cover for `pages[0]`:** the section type is `cover` and contains exactly one block; default template is `Cover 4` (compact: author card + course structure + start button). Alternatives: `Cover 1` (full, with progress bar), `Cover 6` (minimal). Choose by what is actually present in `project.json` and the first page (author photo? hero image?).

**Final-page footer:** append a closing `Footer 1` (or `Footer 2` if there is branding/copyright data in `project.json`) to the last page.

**Variety rule:** within one page, do not use the same `templateName` more than twice in a row. The parser's rotators already enforce this for headings and dividers; for other clusters, override the parser's choice in §7 only if you can stay within the same family from this table.

**Do not invent ids.** `bankContentItems` keys come **only** from the `bankContentSchema` of the chosen template. If a key is missing, downgrade to the closest compatible template in the same row of the table.

### 9. Project metadata

- If `project.json#/name` changed, call `update_editor_project`.
- If `project.json#/description` changed and the course has a Cover block, update the Cover block's description field — there is no separate project-level description endpoint.

### 10. Persist `.sync.json`

Only on full success. Write the in-memory state to `<dir>/.sync.json`. Update `project.json#/id` and `project.json#/companyId` if they were `null`.

## Error handling

- Any MCP call fails → stop, report which step failed, do not write `.sync.json`. The next run sees the same starting state and retries idempotently.
- Asset upload partially fails → call `cancel_s3_uploads` for orphan sessions before exiting.
- Block schema validation fails on one item → log the offending key, skip that block, continue the batch. The user fixes the page and reruns.
- The user interrupts mid-run → operations applied so far are durable in Parta; `.sync.json` is not updated, so the next run resumes from a consistent state.

## Output

End with a short summary:

```text
Sync productive-work-with-ai-agents → Parta
  project: prj_abc (https://app.parta.io/...)
  +  3 pages created (32 blocks)
  ~  1 page updated (4 blocks changed)
  ↕  2 pages reordered
  -  0 pages deleted
  +  4 assets uploaded
  ~  1 asset re-uploaded
  unreferenced server assets: 2 (fm_…, fm_…)
```

Always include the project URL via `get_project_link`.

## What NOT to do

- Do not invent `bankContentItems` keys; downgrade to the next compatible template in §8 instead.
- Do not edit `.sync.json` by hand. Do not edit `id` or `companyId` in `project.json` after the first successful sync.
- Do not push this repo to GitHub from this skill. Mirror-to-GitHub is a separate future hook.
- Do not implement the reverse direction (Parta → markdown).

## Future hooks (out of scope for v1)

- **Mirror to GitHub** — after a successful Parta sync, push the changed files via the GitHub MCP `push_files`.
- **Schedule** — wrap this command in the `schedule` skill so the sync runs hands-off.
- **Bidirectional sync** — pull from Parta into markdown with conflict resolution.
