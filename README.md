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

After the first sync, each project also contains a `.sync.json` recording what was last pushed (project id, section ids per page, file ids per asset, file hashes, last-sync timestamp). It's how the skill computes a delta on subsequent runs.

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

In Claude Code, from this repo:

```text
/parta-sync mcp-server-project
```

On first run the skill creates the project in Parta (you'll be asked which company), uploads assets, creates one section per page, and fills the blocks with the markdown converted to richText. It writes the resulting ids back into `mcp-server-project/.sync.json`.

On subsequent runs it diffs the working tree against `.sync.json` and only touches what changed:

- new page → `create_editor_section` + `create_editor_block` + `update_editor_block`
- changed page content → `update_editor_block`
- reordered pages → `move_editor_section`
- removed page → `delete_editor_section`
- new/changed asset → `create_s3_uploads` (+ block update for the new fileId)

See [`.claude/skills/parta-sync/SKILL.md`](.claude/skills/parta-sync/SKILL.md) for the full algorithm and the MCP calls it makes.

## Roadmap

- **Mirror to GitHub** via the GitHub MCP (`push_files` on a delta) so the repo doubles as a versioned backup.
- **Schedule the sync** with the `schedule` skill so changes flow into Parta without manual triggers.
- **Bidirectional sync** so edits made in the Parta editor flow back into the markdown sources.
