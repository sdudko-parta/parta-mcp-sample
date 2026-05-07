Sync all Parta course projects in the GitHub repository `sdudko-parta/parta-mcp-sample` (branch `main`) into Parta.

This task is MCP-only. Do NOT cd to any directory, do NOT run `git pull`, do NOT run `npm install`, do NOT touch a local working tree. Everything reads through the GitHub MCP and writes through the GitHub MCP and the Parta MCP. The `parta-sync` skill at `.claude/skills/parta-sync/SKILL.md` (in that repo, on `main`) documents the full algorithm — load it via `get_file_contents` and follow it.

## Steps

1. Sanity-check that GitHub MCP write works. `create_or_update_file` a tiny file `.parta-sync-write-probe` at the repo root with content `ok`, then `delete_file` it. If either call fails with 403, abort with a clear message naming the failing call — the OAuth token is read-only and the user needs to disconnect/reconnect the GitHub MCP integration.

2. For each course directory at the repo root that contains a `project.json`, in this order:

     - `mcp-server-project`

     - `productive-work-with-ai-agents`

     - `sample-project-1`

   run `/parta-sync <dir>`. The skill reads `<dir>/project.json`, all `<dir>/pages/*.md`, the `<dir>/assets` listing, and `<dir>/.sync.json` via `get_file_contents`. It uploads referenced assets via `upload_file_from_url` against `https://raw.githubusercontent.com/sdudko-parta/parta-mcp-sample/main/<path>`, creates/updates sections and blocks in Parta from the **Parta Quick-Start Collection** template group, and commits the new `<dir>/.sync.json` (and `<dir>/project.json` on first sync) back to `main` via `create_or_update_file`.

3. The skill short-circuits at its §0 manifest check if the per-course `.sync.json` shows no delta — it prints a zero-counter summary with a `manifest match — no Parta calls` marker, makes no Parta calls, and produces no commits. That is the expected outcome on most days. Don't treat "no changes" as an error.

4. If any `/parta-sync` invocation fails, stop, report the failing directory and the underlying error, and skip the remaining directories. Don't write `.sync.json` on failure (the skill already does the right thing here). The next run will retry from a consistent state.

## Output

Post one line per project:

- `<dir>: synced <project URL> — + <created> pages, ~ <updated>, ↕ <reordered>, - <deleted>; assets + <uploaded>, ~ <re-uploaded> (rebound <N>, dropped <M>); state commit <sha>` if there was a delta. `rebound` counts blocks whose `fileMetaId` was swapped because the underlying asset changed; `dropped` counts old `fileMetaId`s deleted from Parta after rebind.

- `<dir>: no changes` if nothing changed.

## Constraints

- Default branch is `main` for every read and write. Don't branch.

- Don't push raw image URLs (`raw.githubusercontent.com/...`) into block content. Always go through `fileMetaId` returned by `upload_file_from_url`.

- Don't edit `.sync.json` directly outside the skill's own write — the skill manages it.

- Don't edit `id` or `companyId` in `project.json` after the first successful sync.

- If the `parta-sync` skill is missing on `main`, abort with a clear message naming the missing file. Do not attempt to recreate it.
