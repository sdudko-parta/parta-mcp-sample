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
/parta-sync coffee-brewing-basics
```

The argument is the **course name** — the directory name under `projects/`, never a path. The skill resolves every read/write to `projects/<arg>/...` internally.

If invoked without an argument, list `projects/` via `get_file_contents(owner=sdudko-parta, repo=parta-mcp-sample, path=projects)`, keep entries with `type == "dir"` whose listing contains a `project.json`, and ask the user which one to sync. Adding or removing a course is purely a `projects/` directory change — the skill picks it up automatically; nothing else has to be edited.

For scheduled runs the same command is used. The scheduler does not need a working directory and must not run `git pull` or any other shell setup — every read and write goes through MCPs.

## Branching, PR, and merge

Every change the skill produces lands on a per-run feature branch — it never writes directly to `main`. The skill owns the full branch → PR → merge lifecycle. Callers (interactive `/parta-sync`, scheduled routines) just invoke the skill; they do not pre-create branches or open PRs themselves.

Lifecycle:

1. **Reads always come from `main`.** `project.json`, `pages/*.md`, the `assets` listing, `.sync.json`, and the `upload_file_from_url` raw URLs all reference `main`. The branch is a write target only.
2. **Lazy branch creation.** Do **not** create the branch up front. Only create it once §0's manifest check has decided that something actually needs to change — i.e., right before §10 is about to commit the new `.sync.json`. If §0 short-circuits, no branch is created and no PR is opened. This keeps cron runs that produce no diff completely silent on the GitHub side.
3. **Branch name.** `claude/parta-sync-<dir>-<UTC-YYYYMMDD-HHMMSS>` (UTC seconds resolution prevents collisions across rapid consecutive runs). Created via `create_branch(owner=sdudko-parta, repo=parta-mcp-sample, branch=<name>, from_branch=main)`. A `403` here is the write-auth canary — abort with a clear "GitHub MCP write not authorized — reconnect the integration" message before any further calls.
4. **All writes target the branch.** Every `create_or_update_file` and `delete_file` the skill issues passes `branch=<name>`. This includes the `.sync.json` commit in §10. The skill never calls `create_or_update_file` against `main`.
5. **PR + merge at the end.** After §10 succeeds, call `create_pull_request(owner=sdudko-parta, repo=parta-mcp-sample, head=<branch>, base=main, title="parta-sync: <dir>", body=<the per-project summary block from "Output">)`, then immediately `merge_pull_request(pull_number=<n>, merge_method="squash")`. Do not wait for review — this is a policy mandate (see CLAUDE.md "Git workflow"). Capture the PR URL and merge SHA for the summary.
6. **On failure.** If anything between §0.5 and §10 fails, leave the branch in place for inspection — do **not** open a PR, and do **not** attempt to delete the branch (the GitHub MCP exposes no `delete_branch`/`delete_ref` tool, and a half-merged branch deleted from underneath would lose forensic data anyway). The next run starts a fresh branch with a different timestamp, so there is no collision.
7. **Idempotency contract is preserved.** `.sync.json` only lands on `main` after the merge, so a failure mid-run leaves `main` exactly as it was — the next run sees the same starting state and retries from scratch. This is the same invariant the skill had before branching was introduced; the branch is invisible to it.

## Inputs (read via GitHub MCP)

All course content lives under `projects/`. Throughout this section `<dir>` is the **course name** (the directory under `projects/`); the actual GitHub paths the skill passes to `get_file_contents` are `projects/<dir>/...`.

| Path                          | How to read                                                          | Role                                                                                                                                  |
|-------------------------------|----------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------|
| `projects/schema.json`        | `get_file_contents(owner=sdudko-parta, repo=parta-mcp-sample, path=projects/schema.json)` | JSON Schema for `project.json`. Validate `project.json` locally before any Parta call.                       |
| `projects/<dir>/project.json` | `get_file_contents(owner=sdudko-parta, repo=parta-mcp-sample, path=projects/<dir>/project.json)` | Course shell. Capture the file's git blob `sha` from the response — recorded in `.sync.json.projectJsonBlobSha` for the §0 manifest check on the next run. |
| `projects/<dir>/pages/<file>.md` | `get_file_contents(owner=sdudko-parta, repo=parta-mcp-sample, path=projects/<dir>/pages/<file>.md)` | One markdown file per page; referenced from `project.json#/pages[*].ref`. Capture each file's blob `sha`.  |
| `projects/<dir>/assets`       | `get_file_contents(owner=sdudko-parta, repo=parta-mcp-sample, path=projects/<dir>/assets)` (returns directory listing) | Each entry has the asset's git blob `sha` and `size`. This is the asset inventory.              |
| `projects/<dir>/.sync.json`   | `get_file_contents(owner=sdudko-parta, repo=parta-mcp-sample, path=projects/<dir>/.sync.json)` | (Optional) state from the previous successful sync. Drives the delta. A 404 means first run — do not treat as an error. |

The git blob `sha` returned by GitHub for each file is content-addressed and stable — use it directly as the change-detection key. Don't compute sha256 yourself; you have no local file to hash.

Every read above omits the `ref` parameter and therefore resolves against `main`. The skill never reads from a feature branch; the working branch is a write target only.

## State persisted (written via GitHub MCP)

After a successful sync, write `projects/<dir>/.sync.json` to the **course repo** (`sdudko-parta/parta-mcp-sample`) via `create_or_update_file(branch=<working branch>)` (see "Branching, PR, and merge" — the working branch is created lazily in §10). Commit message: `parta-sync state: <dir>`. Once §11 merges the PR, `.sync.json` lands on `main` and becomes visible to the next run's §0 manifest check.

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
  "templateSchemas": {
    "Heading 1":              { "…": "bankContentSchema body returned by get_editor_block_by_template_id" },
    "Heading 2 with Caption": { "…": "…" },
    "Text":                   { "…": "…" }
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

`project.json` is read-only for the skill — it is never written back. The Parta project id and company id are recorded **only** in `.sync.json.remote` (resolved on the first run, reused thereafter).

## Algorithm

### 0. Manifest short-circuit

The most common case on a cron run is "nothing changed." Fail fast before any parsing, schema validation, or template work.

In a single batch (parallel `get_file_contents` calls):

1. `projects/<dir>/project.json` — capture body and blob `sha`.
2. `projects/<dir>/pages` — directory listing; capture each page path and blob `sha`.
3. `projects/<dir>/assets` — directory listing; capture each asset path, blob `sha`, and `size`.
4. `projects/<dir>/.sync.json` — previous state. 404 → first run; skip the comparison and fall through to §1, reusing the data above.

If `.sync.json` exists, compare four things against the recorded slice:

- `projectJsonBlobSha` matches the current `project.json` blob `sha`.
- The ordered list of `pages[*].ref` in the current `project.json` matches the keys in `.sync.json.pages` in the same order.
- For every page, the current blob `sha` matches `.sync.json.pages[ref].blobSha`.
- The set of asset paths is identical, and every asset's blob `sha` matches `.sync.json.assets[path].blobSha`.

All four match → exit with "no changes": print the summary using the recorded `projectId` and zero counts. Do **not** call any Parta MCP. Do **not** rewrite `.sync.json`.

Any mismatch → fall through to §1, **reusing the data already fetched** (don't re-fetch `project.json`, the page listing, the assets listing, or `.sync.json`).

### 1. Validate

1. `get_file_contents(repo=parta-mcp-sample, path=projects/schema.json)` → parse the JSON Schema once.
2. Validate `project.json` (already fetched in §0) against the schema, especially `pages[*].ref` matches `^pages/.+\.md$`.
3. Fetch every `projects/<dir>/<ref>` from `pages[*].ref` **in parallel** via `get_file_contents`. A 404 on any of them aborts the run with a message naming the missing page. Capture each file's blob `sha`.

### 2. Resolve company and project

- If `projects/<dir>/.sync.json` exists in the course repo and records `remote.projectId`, verify the project still exists with `list_editor_projects`. If gone, treat as a fresh sync (drop the in-memory state; do not delete `.sync.json` yet — §10 will overwrite it).
- Else (fresh sync — no `.sync.json` yet, or its project id no longer resolves):
  - Call `list_companies` and ask the user to pick one.
  - Call `create_editor_project` with the resolved company and `project.json#/name`.
  - Buffer the new `companyId` and `projectId` in memory; they are persisted into `.sync.json.remote` at §10.

### 3. Resolve the template group and template ids

Once per sync:

1. `list_editor_template_groups` for the company. Pick the group whose name is exactly `Parta Quick-Start Collection` (`get_template_choice_defaults` confirms the default).
2. `list_editor_templates` for that group. Build a `templateName → templateId` map.
3. For every template name referenced in §8, call `get_editor_block_by_template_id` **in parallel** (one fan-out across all templates — these are independent reads). Cache the returned `bankContentSchema` per template. That schema is the source of truth for content keys.

**Cross-run cache.** If `.sync.json.templates` and `.sync.json.templateSchemas` are both populated from a prior run, reuse them and skip the entire section — schemas are stable unless someone edits the template in Parta. A `validation.errors` response on a write in §7 is the cache-miss signal: refetch only that one template's schema (single `get_editor_block_by_template_id` call), update the in-memory cache, and retry just the offending block. Don't refetch the whole group — the other templates didn't change. The §0 manifest short-circuit means most cron runs never reach §3 anyway, but skipping it on a content-edit run still saves ~16 round-trips against Parta.

### 4. Build the desired state

For each entry in `project.json#/pages`, in order:

1. From the page contents fetched in §1, capture the markdown body and the file's git blob `sha`.
2. Parse the markdown in-context: walk the AST node by node, applying the mapping table in §8. Produce an ordered block plan `[{ nodeKey, templateName, payload }]`.
   - `nodeKey` = `<type>#<index>` where the index is per-type within this page (`h1#0`, `h2#0`, `h2#1`, `p#0`, `image#0`, `code#0`, …). It is stable across re-runs unless the markdown structure itself changes.
   - `templateName` comes from the table; resolve variants per the variety rule below.
   - `payload` carries the rendered HTML for richText slots, the asset reference for image/video/audio slots, and the raw fields for code/table slots.
3. Collect every asset reference found in the page (`![alt](../assets/foo.png)`, link nodes that point at downloadable types). Resolve to a course-relative path (`assets/foo.png`) — this is the key written into `.sync.json.assets`. The repo-relative form `projects/<dir>/assets/foo.png` is only used when calling `get_file_contents` or building the `upload_file_from_url` raw URL.

After all pages have been parsed, the `projects/<dir>/assets` directory listing fetched in §1 is the master asset inventory — each entry has `path`, `sha`, `size`.

### 5. Sync assets first

A page block can only embed an uploaded file by `fileMetaId`. The asset stream and the page stream are independent: assets are reconciled first, then pages pull the current `path → fileMetaId` map at write time. This is what lets a pure asset swap (image bytes change, markdown unchanged) still propagate into Parta.

Asset uploads are independent — issue `upload_file_from_url` calls **in parallel** across paths. The only ordering constraint is that all of §5 must finish before §7 starts writing block content.

For each asset referenced by at least one page:

1. If `.sync.json.assets[path]` exists and the recorded `blobSha` matches the current one from the directory listing, reuse `fileMetaId`. Skip upload.
2. Otherwise call `upload_file_from_url` with `https://raw.githubusercontent.com/sdudko-parta/parta-mcp-sample/main/projects/<dir>/<path>` where `<path>` is the course-relative key (`assets/<file>`). Capture the returned `fileMetaId`.
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
   - `image` slot ← `{ source: "file", fileId: "<uuid>", alt, zoomable: false, overlay: null }`. The `fileId` is the UUID returned by `upload_file_from_url` in §5. **Never** inline an `<img src=…>` to a relative repo path or to a `raw.githubusercontent.com` URL; if the chosen template has no `image` slot, downgrade to the next template in the §8 family that does (this is the only place the skill overrides the parser's `templateName`).
   - `code` slot ← `{ language, code }` from the fenced block (`language` from the info string; default `text`).
   - `table` slot ← `{ header, rows }` from the GFM table; do not transform cells.
   - `caption`, `heading`, `label`, `url` ← copy from the parsed payload by name.
3. Build `bankContentItems` covering **every slot declared in the cached schema for this template** — not just the slots the markdown filled. Slots present in the parsed payload get the rendered value; slots the markdown didn't fill get the empty sentinel for the slot's declared type (`""` for string, `[]` for array, `null` for object/`fileId`-bearing slot). This is what overwrites stale content surviving from an earlier template revision — Parta's update is merge-semantics, so any slot you omit keeps its old value. Do not invent keys outside the schema.
4. **Always batch.** Call `update_editor_blocks` with up to 50 blocks of one section per call (one batch per section). A single `update_editor_block` is only for retrying the one item the batch endpoint rejected. Inspect `validation.errors`; retry only the offending entries.
5. **Verify the write (read-after-write).** After the batch returns success, re-fetch every block that was created or updated this run via `get_editor_block` **in parallel — across all sections and all blocks**. Reads are not section-transactional, so this fan-out is unconstrained and adds one round-trip of latency, not N. For each block, compare the persisted `bankContentItems` slot-by-slot against the desired payload from step 3:
   - `richText`: parse-and-restringify both sides through the same HTML normalizer; compare the normalized strings (whitespace and self-closing-tag spelling are not significant).
   - `image`: literal match on `fileId`, `alt`, `zoomable`, `overlay`.
   - `code`: literal match on `language` and `code`.
   - `table`: structural match on `header` and `rows`.
   - Scalars (`caption`, `heading`, `label`, `url`, …): literal match.
   On any mismatch, re-issue `update_editor_block` for that one block exactly once, then re-fetch and re-compare. If the second read-back still differs, log the block id, the offending slot, and `desired` vs `persisted` values, then **abort the run before §10 — `.sync.json` is not written**, so the next run retries idempotently from a known-good state. This step exists specifically because Parta has shown the "old slot data persists after update" failure mode intermittently; without verification the run silently records a stale-but-plausible state in `.sync.json` and the next run sees no diff to fix.

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

### 10. Persist `.sync.json` and clean up replaced assets

Only on full success — i.e., §7 finished without leaving any block pointing at a stale `fileMetaId`.

1. **Create the working branch** (lazy, see "Branching, PR, and merge" above). `create_branch(owner=sdudko-parta, repo=parta-mcp-sample, branch=claude/parta-sync-<dir>-<UTC-YYYYMMDD-HHMMSS>, from_branch=main)`. This is the first GitHub write of the run; a `403` here aborts with the write-auth message and no Parta state is persisted. Hold the branch name for the next two steps and §11.
2. For each id in `replacedFileMetaIds` (collected in §5), call the **Parta MCP** `delete_file(fileMetaId=<old>)` (note: this is the Parta tool, not the GitHub one) **in parallel**. A failure here is logged but does not abort the run — by this point all blocks already point at the new asset, so the orphan is harmless. **Order matters:** never delete before §7 completes; otherwise a transient block would reference a missing file.
3. Build the new `projects/<dir>/.sync.json` payload. `projectJsonBlobSha` is the blob `sha` captured in §0 — `project.json` is never modified by the skill, so this value is always the one that was just read.
4. Write `projects/<dir>/.sync.json` via `create_or_update_file(branch=<working branch>, path=projects/<dir>/.sync.json, …)`. On a fresh sync (no prior `.sync.json` blob `sha`) omit the `sha` parameter; otherwise pass the `sha` captured in §0 (the blob lives on `main` — that is what we're branching from, so it is the correct base sha for the create-or-update against the new branch). Commit message: `parta-sync state: <dir>`.

Exactly one commit per course on every run that reached §10, on the working branch.

### 11. Open the PR and merge

Immediately after §10's commit succeeds, in two sequential calls:

1. `create_pull_request(owner=sdudko-parta, repo=parta-mcp-sample, head=<working branch>, base=main, title="parta-sync: <dir>", body=<the summary block from "Output", including project URL and counters>)`. Capture the returned `number` and `html_url`.
2. `merge_pull_request(owner=sdudko-parta, repo=parta-mcp-sample, pull_number=<number>, merge_method="squash", commit_title="parta-sync: <dir>")`. Capture the merge `sha`.

No user confirmation. No waiting. This is the policy mandated by CLAUDE.md and the routine instruction; the skill executes it on every successful run.

If `create_pull_request` fails, log it and stop — the branch is on the remote and can be inspected. Do not retry blindly; common cause is a transient GitHub error and the next scheduled run will create a fresh branch.

If `merge_pull_request` fails (e.g., branch protection enforced), log the PR URL and stop. The branch and PR remain for the user to merge by hand. The next run still starts from `main` and retries idempotently — the unmerged PR will simply look stale and can be closed.

## Error handling

- Any MCP call fails → stop, report which step failed, do **not** persist `.sync.json`. The next run sees the same starting state and retries idempotently.
- `create_branch` returns `403` → GitHub MCP write auth is broken (read-only token). Abort with that exact message before any Parta calls; the user must reconnect the GitHub MCP integration.
- Asset upload fails (`upload_file_from_url` non-2xx) → stop, name the asset, exit. No branch was created yet (asset upload runs in §5, branch creation is §10.1) so there is nothing to clean up on the GitHub side.
- `bankContentItems` validation fails on one item → log the offending key, skip that block, continue the batch. Re-running after a fix is safe.
- The user interrupts mid-run → operations applied to Parta so far are durable; if the branch was created, leave it. The next run starts a fresh branch and retries from a consistent state since `.sync.json` on `main` is unchanged.
- A `create_or_update_file` 409 on `.sync.json` (race against another writer) → re-fetch the blob `sha` from `main` (the base, not the branch — the branch was just created from `main` so they match), rebuild the payload from current Parta state, retry once. If it still 409s, report and stop.
- `create_pull_request` or `merge_pull_request` fails → the branch is preserved on the remote with the state commit on it. Print the branch name and (if available) the PR URL, then stop. Do not delete the branch (the GitHub MCP cannot, and a human can salvage by merging manually). The next run starts a fresh branch and retries.

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
  branch: claude/parta-sync-productive-work-with-ai-agents-20260508T143012Z
  state commit: <branch-sha>
  PR: #<n> <html_url> (merged as <merge-sha>)
```

Always include the project URL via `get_project_link`.

When §0 short-circuits (manifest match, no Parta calls made), no branch is created and no PR is opened. Still print the same block — just with all counters at zero, no `branch` / `PR` lines, and a `manifest match — no Parta calls, no branch` line in place of `state commit`. This keeps cron logs readable without misleading anyone into thinking the run was skipped entirely.

## What NOT to do

- Do not invent `bankContentItems` keys — downgrade to the next compatible template in §8 instead.
- Do not edit `.sync.json` by hand.
- Do not push raw image URLs (`raw.githubusercontent.com/...`) into block content. Always go through `fileMetaId`.
- Do not assume any local working tree, `npm install`, or `git pull`. Everything is MCP-only.
- Do not write directly to `main` — every `create_or_update_file` and `delete_file` call must specify the working `branch=…`. The skill is the only thing that should ever push commits in the parta-sync workflow, and it always pushes to a feature branch.
- Do not skip the PR + merge step on success. The merge is the contract: it is what makes `.sync.json` on `main` reflect Parta state for the next run's manifest check.
- Do not pre-create the branch in §0. Lazy creation is what keeps the no-op cron path silent on GitHub.
- Do not implement the reverse direction (Parta → markdown). Out of scope.

## Future hooks (not for v1)

- **Bidirectional sync** — pull from Parta into markdown with conflict resolution.
- **Multiple repos / multiple base branches** — current skill is hard-bound to `sdudko-parta/parta-mcp-sample` and reads/PRs against `main`. The per-run write branch is generated; only the read base is fixed. Parametrize the read base if a non-`main` workflow becomes a requirement.
