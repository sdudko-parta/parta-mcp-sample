# CLAUDE.md

Context for Claude Code working inside this repo.

## What this repo is

A reference layout for Parta course projects mirrored as plain files. Each course is a directory with `project.json` (validated by `schema.json` at the repo root), `pages/*.md`, and `assets/*`. The `parta-sync` skill in `.claude/skills/parta-sync/` pushes the local state into Parta via the Parta MCP.

This is **not** a code project — there is no build, no tests, no runtime. It's content + one skill. The skill itself ships two small Node helpers under `.claude/skills/parta-sync/scripts/`; their deps are declared in `.claude/skills/parta-sync/package.json` and installed with `npm install --prefix .claude/skills/parta-sync` (one-off, Node ≥ 18.17).

## Conventions when editing courses

- **`project.json` is the source of truth for structure.** Order, names, and refs in the `pages` array drive what happens in Parta on the next sync.
- **Page filenames are stable identities.** A page is "the same page" across syncs as long as its `ref` doesn't change. Renaming a page is fine; renaming `ref` is treated as delete + create.
- **Assets live in `assets/`.** Reference them from pages with `../assets/<file>`. Don't deep-link to absolute URLs unless the asset is intentionally external.
- **American English** for all course content. Match the existing tone (short, direct, second person).
- **No emojis** in course content unless the user explicitly asks.

## Adding a new course

1. `cp -r sample-project-1 my-new-course`
2. Edit `my-new-course/project.json` — set `companyId`, `name`, `description`, replace the `pages` array.
3. Add page markdown under `pages/` matching the `ref` paths.
4. Drop assets into `assets/`.
5. Run `/parta-sync my-new-course`.

## Adding a new page to an existing course

1. Add the markdown file under `<course>/pages/`.
2. Add an entry to `pages` in `project.json` at the desired position.
3. Run `/parta-sync <course>` — only the new section + content for it gets created.

## Things not to touch by hand

- `.sync.json` in any course — written by the sync skill; editing it can desync the project.
- The `id` and `companyId` fields of `project.json` once the project has synced — overriding them will create a duplicate Parta project.

## MCP servers used

- **Parta MCP** for project/section/block CRUD, template discovery, and S3 file uploads. The sync skill is the only thing that should call these directly. It draws block templates from the **Parta Quick-Start Collection** template group.
- **GitHub MCP** — reserved for the future "mirror to GitHub" flow. Don't push from this repo unless explicitly asked.

## When in doubt

Read `.claude/skills/parta-sync/SKILL.md`. It documents the diff algorithm and the exact MCP calls for every kind of change.
