Sync all Parta course projects in the GitHub repository `sdudko-parta/parta-mcp-sample` into Parta.

This task is MCP-only. Do NOT cd to any directory, do NOT run `git pull`, do NOT run `npm install`, do NOT touch a local working tree, do NOT shell out to `git` or `gh`. Everything reads through the GitHub MCP and writes through the GitHub MCP and the Parta MCP. The `parta-sync` skill at `.claude/skills/parta-sync/SKILL.md` (in that repo, on `main`) documents the full algorithm — load it via `get_file_contents` and follow it.

## Branching, PR, and merge — non-negotiable

Every change MUST land on a per-course feature branch named `claude/parta-sync-<dir>-<UTC-YYYYMMDD-HHMMSS>` and reach `main` via a PR that you (the agent) open and merge yourself. ALWAYS. No user confirmation, no interactive prompt, no exceptions:

- Reads come from `main`. The skill's raw asset URLs and every `get_file_contents` call resolve against `main`.
- Writes (`create_or_update_file`, `delete_file` — both GitHub MCP) MUST pass `branch=<feature branch>`. Never write to `main` directly.
- The skill itself owns the branch → PR → merge lifecycle (see SKILL.md §10–§11). This routine simply invokes `/parta-sync <dir>` per course; do not pre-create branches or open PRs from here.
- Squash-merge via `merge_pull_request(merge_method="squash")`. The skill does this automatically; if it reports a merge failure, surface the PR URL and stop — do not attempt to merge by hand here.
- If the §0 manifest check finds no delta for a course, the skill creates no branch and opens no PR for that course. That is the expected outcome on most cron runs and is not an error.

## Steps

1. For each course directory at the repo root that contains a `project.json`, in this order:

   - `mcp-server-project`
   - `productive-work-with-ai-agents`
   - `sample-project-1`

   run `/parta-sync <dir>`. The skill reads `<dir>/project.json`, all `<dir>/pages/*.md`, the `<dir>/assets` listing, and `<dir>/.sync.json` from `main` via `get_file_contents`. It uploads referenced assets via `upload_file_from_url` against `https://raw.githubusercontent.com/sdudko-parta/parta-mcp-sample/main/<path>`, creates/updates sections and blocks in Parta from the **Parta Quick-Start Collection** template group, then (only if there is a delta) creates the feature branch, commits the new `<dir>/.sync.json` to it, opens a PR to `main`, and squash-merges the PR. Each course is fully independent: its own branch, its own PR, its own merge.

2. If any `/parta-sync` invocation fails, stop, report the failing directory and the underlying error (including the partial branch name and PR URL if either was created), and skip the remaining directories. The skill will not have written `.sync.json` to `main` on failure (the merge is the only thing that lands state on `main`), so the next run retries from a consistent state.

## Output

Post one line per course:

- `<dir>: synced <project URL> — + <created> pages, ~ <updated>, ↕ <reordered>, - <deleted>; assets + <uploaded>, ~ <re-uploaded> (rebound <N>, dropped <M>); branch <branch> → PR #<n> <url> merged as <sha>` if there was a delta. `rebound` counts blocks whose `fileMetaId` was swapped because the underlying asset changed; `dropped` counts old `fileMetaId`s deleted from Parta after rebind.

- `<dir>: no changes` if §0 short-circuited (no branch, no PR, no Parta calls).

- `<dir>: failed at <step> — <error>; branch <branch> (left for inspection); PR <url-or-none>` on failure.

End with a single line: `routine: <K> synced, <L> no-change, <M> failed`.

## Constraints

- Reads come from `main` only. Writes go to a per-course feature branch only. Never write to `main` directly. The skill enforces this — do not work around it from this routine.
- Do NOT shell out to `git`, `gh`, `npm`, `node`, or any other CLI. Only the GitHub MCP and the Parta MCP. There is no working tree.
- Do not push raw image URLs (`raw.githubusercontent.com/...`) into block content. Always go through `fileMetaId` returned by `upload_file_from_url`.
- Do not edit `.sync.json` directly outside the skill's own write — the skill manages it.
- If the `parta-sync` skill is missing on `main`, abort with a clear message naming the missing file. Do not attempt to recreate it.
- If `create_branch` returns `403` on the very first course, the GitHub MCP token is read-only — abort the entire routine with that exact message; the user needs to disconnect/reconnect the GitHub MCP integration. Do not retry, and do not attempt the remaining courses.
