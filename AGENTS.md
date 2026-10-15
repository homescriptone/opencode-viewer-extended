# AGENTS.md

## Project Overview

OpenCode Session Viewer — a local web GUI for browsing, searching, editing, and exporting OpenCode AI coding sessions. It reads from and writes to the OpenCode SQLite database (`~/.local/share/opencode/opencode.db`) and renders a three-panel interface (projects, sessions, and messages with tool calls).

## Stack

- **Runtime**: [Bun](https://bun.sh) (required — uses `bun:sqlite`)
- **Server**: `server/` — `launch.ts` (HTTP + REST API), `database.ts` (SQLite layer)
- **Frontend**: `public/` — `index.html`, `script.js`, `styles.css` (vanilla JS, no build step)
- **CLI**: `bin/cli.ts` — entry point for `bunx opencode-viewer-extender`

## Key Files

| Path | Purpose |
|---|---|
| `bin/cli.ts` | CLI parsing, env setup, auto-open browser |
| `server/launch.ts` | Bun.serve HTTP server, routing, static files, exports |
| `server/database.ts` | SQLite connection, prepared statements, write layer, shared DB helpers |
| `public/index.html` | Page shell (loads `plugin-api.js`, `script.js`, `styles.css`) |
| `public/script.js` | SPA logic (state, rendering, selection, export, edit UI) |
| `public/plugin-api.js` | Plugin registry (`window.OCV`) + ZIP helper |
| `public/styles.css` | Design system styles (CSS variables) |
| `public/plugins/*.js` | Drop-in plugins (discovered at startup) |

## Architecture

```text
bin/cli.ts            → CLI args, env setup, auto-open browser
server/launch.ts      → Bun.serve HTTP server, routing, static files
server/database.ts    → SQLite connection, prepared statements, shared helpers
public/index.html     → Page shell, loads styles.css + script.js
public/script.js      → Single-page app logic (vanilla JS, no framework)
public/plugin-api.js  → Plugin API + ZIP utilities
public/plugins/*.js   → User/drop-in plugins
public/styles.css     → Styles
```

## Database Behavior

- **Read-only by default.** The server opens `opencode.db` in read-only mode unless `--write` (or `OCV_WRITE=1`) is set.
- **Write mode.** With `--write`, it opens read-write and enables foreign keys so deletions cascade. Write requests return `403` when edit mode is off.
- **WAL + checkpoints.** Uses SQLite WAL. After bulk deletes/reclaims it runs `PRAGMA wal_checkpoint(TRUNCATE)` and sets `PRAGMA journal_size_limit` to avoid unbounded WAL growth.
- **Event log hygiene.** OpenCode's append-only `event`/`event_sequence` tables are not FK-linked to `session`. Deleting sessions/projects also purges their event rows; `POST /api/purge-events` (and the Reclaim flow) removes orphaned aggregates so a subsequent VACUUM can shrink the DB file.
- **Safe updates.** All updates only touch whitelisted columns and auto-bump `time_updated`. IDs use typed prefixes (`proj_`, `ses_`, `msg_`, `prt_`) when server-generated.

## API Surface

### Reads

- `GET /api/projects` — All projects
- `GET /api/projects/:id/sessions?page=&limit=&q=&scope=` — Paginated/searchable project sessions
- `GET /api/sessions/search?q=&scope=&page=&limit=` — Global session search
- `GET /api/sessions/:id` — Session detail (session + messages + parts)
- `GET /api/sessions/:id/subagents` — Subagent sessions
- `GET /api/sessions/:id/export?format=md|json` — Export single session
- `GET /api/parts/:id/image` — Base64 image extraction
- `GET /api/events` — Event-log stats (totals/orphaned/aggregates)
- `GET /api/plugins` — Discovered plugins
- `GET /api/config` — Server/config metadata
- `GET /api/db` — DB size, free/reclaimable pages

### Writes (require `--write`)

- **Projects**: `POST/PATCH/PUT/DELETE /api/projects` and `/api/projects/:id`
- **Sessions**: `POST/PATCH/PUT/DELETE /api/sessions` and `/api/sessions/:id`
- **Messages**: `POST /api/sessions/:id/messages`, `PATCH/PUT/DELETE /api/messages/:id`
- **Parts**: `POST /api/messages/:id/parts`, `PATCH/PUT/DELETE /api/parts/:id`
- **Maintenance**: `POST /api/vacuum`, `POST /api/checkpoint`, `POST /api/bulk-delete`, `POST /api/purge-events`

## Frontend

- **Self-contained** in `public/` (vanilla JS, no framework, no build step).
- **Three-panel layout**: projects (left), sessions (middle), messages+tool calls (right).
- **Client-side state** for selection, search, edit mode, plugins.
- **Plugin-aware**: loads `plugin-api.js` before `script.js`; plugins can extend rendering, exports, actions, and bulk operations.

## Design System

Uses the Koomi KB Redesign design language:

- **Fonts**: Geist + Geist Mono (Google Fonts)
- **Palette**: Warm cream (`#fbfaf7` bg, `#f5f4f0` surfaces, `#e8e6df` borders)
- **Accent**: Teal via `oklch(0.62 0.11 185)`
- **CSS variables**: `--bg`, `--surface`, `--ink`, `--hair`, `--accent`, `--font-sans`, `--font-mono`

## Running & Commands

```bash
bun run dev            # Dev mode with watch (server/launch.ts)
bun run start          # Production (server/launch.ts)
bun run dev -- --write # Dev with edit mode enabled
bun run typecheck      # TypeScript type checking
bunx @homescriptone/opencode-viewer-extender   # CLI (port 3456, auto-opens browser)
```

**Defaults:** CLI defaults to port `3456`. Running `server/launch.ts` directly picks a random port unless `OCV_PORT` is set. Override with `OCV_PORT`, `OCV_DB_PATH`, or `OCV_WRITE=1`.

## Conventions

- **No external dependencies** beyond Bun built-ins.
- **Keep minimal** — avoid splitting files unless necessary or clearly beneficial.
- **Use prepared statements** for all SQL queries (never string-concatenate user input into SQL).
- **Separation of concerns**: `server/database.ts` owns DB access/helpers; `server/launch.ts` owns HTTP routing/static serving.
- **Follow existing code style** — mimic patterns, naming, and structure when editing.
- **Security-first**: Never log or expose secrets/keys. Never commit secrets to the repo.
- **No unnecessary comments** — do not add comments unless explicitly requested by the user.
- **Minimal, direct changes** — make the smallest correct change to satisfy the task.
- **Type correctness** — run `bun run typecheck` after non-trivial changes and before considering work complete when relevant.
- **Do not commit changes** unless the user explicitly asks you to. Never assume commit permission.
- **Prefer search/read first** — understand context (surrounding code, imports, conventions) before editing.

## Safety & Rules for Agents

- **Read before editing**: For existing files, read with sufficient context before making edits. Prefer editing existing files over creating new ones unless explicitly required.
- **Verify with typecheck**: If `bun run typecheck` exists/works, run it after changes that affect types or server code. If unsure of the correct verification command, ask the user.
- **No speculative docs**: Never proactively create `README.md`, `*.md`, or other docs unless explicitly requested.
- **Respect read-only default**: Never attempt writes unless edit mode is requested/justified by the task and explicitly enabled contextually.
- **Preserve behavior**: Avoid changing unrelated code. Keep changes focused and idiomatic to this codebase.
- **Tool use discipline**: Batch independent reads/searches in parallel when useful. Avoid redundant tool calls.

## Release Process

This project uses **npm Trusted Publishing (OIDC)** with [release-please](https://github.com/googleapis/release-please-action) for fully automated releases.

### Automated Flow

1. **Commit with Conventional Commits** — Use `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `perf:`, `test:`, `build:`, `ci:`, or include `BREAKING CHANGE:` in the commit body for breaking changes.
2. **Merge to `main`** — release-please automatically opens or updates a **Release PR** that bumps `package.json`, updates `CHANGELOG.md`, and prepares the next semantic version.
3. **Merge the Release PR** — release-please creates a GitHub Release and pushes the version tag (`vX.Y.Z`).
4. **Auto-publish to npm** — `.github/workflows/publish.yml` triggers on `release: published`, runs `bun install --frozen-lockfile`, `bun check`, optional `build`/`test`, and `npm publish --provenance --access public`.

No manual tagging is required for normal releases.

### Release-Please Config

- **Workflow:** `.github/workflows/release-please.yml` — runs on pushes to `main`, uses `release-type: node`, package `@homescriptone/opencode-viewer-extender`.
- **Publish:** `.github/workflows/publish.yml` — runs on `release: published` (not tag pushes). Also supports `workflow_dispatch` for manual republishing if needed.
- **Trusted Publishing:** Requires npm Trusted Publisher configured for `homescriptone/opencode-viewer-extender` pointing to workflow `publish.yml` (OIDC, no `NPM_TOKEN` secret).

### Manual Fallback

If you need to cut a release manually, push a semantic version tag. The publish workflow will **not** trigger on tag pushes anymore (it now triggers on GitHub Release publication). Prefer the automated release-please flow. If you must force a manual npm publish, use `workflow_dispatch` on the Publish workflow after creating a release/tag.

```bash
git tag v1.4.0
git push origin v1.4.0
```

> Note: With the new setup, pushing tags alone does not auto-publish. Let release-please create the release from the Release PR, or create a GitHub Release from that tag to trigger publishing.

### Agent Rules for Releases

- **Do not guess versions.** Never manually bump versions — let release-please handle it based on Conventional Commits.
- **Enforce Conventional Commits.** When asked to "prepare a release" or "bump version", rewrite/organize commits to follow Conventional Commits, or instruct to merge conventional commits to `main` so release-please can generate the Release PR.
- **Prefer automated path.** If release-please workflows exist, always use the Release PR → merge flow. Only use manual tagging if explicitly requested and the user understands it won't auto-publish without a corresponding GitHub Release.
- **Check CI state.** After a Release PR merges, verify the Release was created and the Publish workflow succeeded. If publish fails, inspect logs and report the failure (do not retry by pushing duplicate tags).
