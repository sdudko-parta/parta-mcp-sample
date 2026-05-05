# parta-mcp-sample

A reference repository that holds Parta course projects as plain files (markdown + assets + a single `project.json`) and ships a Claude Code skill, [`parta-sync`](.claude/skills/parta-sync/SKILL.md), that pushes them into Parta through the Parta MCP.

The same layout makes it easy to also mirror this repo to GitHub via the GitHub MCP, and to run the sync on a schedule.

## Layout

```text
.
├── schema.json                          # JSON schema for project.json
├── sample-project-1/                    # minimal template — copy this for new courses
│   ├── project.json
│   ├── pages/
│   │   ├── 01-welcome.md
│   │   └── 02-getting-started.md
│   └── assets/
│       ├── cover.png
│       └── sync-flow.png
├── mcp-server-project/                  # real 10-page course
│   ├── project.json
│   ├── pages/01-welcome.md … 10-deploy.md
│   └── assets/01-welcome.png … 10-deploy.png
├── productive-work-with-ai-agents/      # real 10-page course
│   ├── project.json
│   ├── pages/01-welcome.md … 10-best-practices.md
│   └── assets/01-welcome.png … 10-best-practices.png
└── .claude/
    └── skills/parta-sync/
        └── SKILL.md
```

After the first sync, each project also contains a `.sync.json` recording what was last pushed (project id, section ids per page, block uuids per markdown node, file ids per asset, git blob shas, last-sync timestamp). It's how the skill computes a delta on subsequent runs. The skill commits `.sync.json` back to `main` itself via the GitHub MCP — you don't write it by hand.

## Anatomy of a project

Every course directory contains exactly:

| File / dir     | Purpose                                                                                         |
|----------------|-------------------------------------------------------------------------------------------------|
| `project.json` | The course shell — id, companyId, name, description, ordered pages. Validated by `schema.json`. |
| `pages/*.md`   | One markdown file per page, referenced from `project.json#/pages[*].ref`.                       |
| `assets/*`     | Images, videos, etc. Referenced from pages by relative path (`![alt](../assets/foo.png)`).      |
| `.sync.json`   | Sync state. Written by `parta-sync`. Safe to delete to force a full re-sync.                    |

The page **order in `project.json` is the source of truth**. Reordering the `pages` array drives `move_editor_section` calls on the next sync.

## Using the sync skill

The skill talks to GitHub through the GitHub MCP and to Parta through the Parta MCP. There is no local clone to maintain, no Node setup, and no `git pull` step — anywhere with both MCPs connected can run the sync.

```text
/parta-sync mcp-server-project
```

On first run the skill creates the project in Parta (you'll be asked which company), uploads each referenced asset via `upload_file_from_url` against its raw GitHub URL, and for every page creates one section (a cover for `pages[0]`, a landing for the rest) plus a sequence of blocks drawn from the **Parta Quick-Start Collection** template group — one block per markdown node (heading, paragraph, image, list, code, quote, table, divider, …). It then commits `mcp-server-project/.sync.json` and the ids in `project.json` back to `main` via the GitHub MCP.

On subsequent runs it compares git blob shas against `.sync.json` and only touches what changed:

- new page → `create_editor_section` + a series of `create_editor_block` + `update_editor_block` per the parsed block plan
- changed page content → `update_editor_block` (and add/remove blocks as the parsed plan dictates)
- reordered pages → `move_editor_section`
- removed page → `delete_editor_section`
- new/changed asset → `upload_file_from_url` against the raw GitHub URL, then a block update with the new `fileMetaId`

Each successful sync produces one or two commits per course: `parta-sync state: <course>` always; `parta-sync init: <course>` only on the very first sync.

See [`.claude/skills/parta-sync/SKILL.md`](.claude/skills/parta-sync/SKILL.md) for the full algorithm, the markdown-node → template mapping, and the MCP calls it makes.

## Roadmap

- **Mirror to GitHub** via the GitHub MCP (`push_files` on a delta) so the repo doubles as a versioned backup.
- **Schedule the sync** with the `schedule` skill so changes flow into Parta without manual triggers.
- **Bidirectional sync** so edits made in the Parta editor flow back into the markdown sources.
