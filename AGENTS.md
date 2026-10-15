# AGENTS.md

## Project

OpenCode Session Viewer — a local web GUI for browsing and editing OpenCode AI coding sessions. Reads from and writes to the OpenCode SQLite database (`~/.local/share/opencode/opencode.db`) and renders a three-panel interface: projects, sessions, and messages with tool calls.

## Stack

- **Runtime**: Bun (required — uses `bun:sqlite`)
- **Server**: `server/` — `launch.ts` (HTTP + REST API) and `database.ts` (SQLite layer)
- **Frontend**: `public/` — `index.html`, `script.js`, `styles.css` (vanilla, no build step)
- **CLI**: `bin/cli.ts` — entry point for `bunx opencode-viewer`

## Architecture

```
bin/cli.ts            → CLI args, env setup, auto-open browser
server/launch.ts      → Bun.serve HTTP server, routing, static files
server/database.ts    → SQLite connection, prepared statements, shared helpers
public/index.html     → Page shell, loads styles.css + script.js
public/script.js      → Single-page app logic (vanilla JS, no framework)
public/styles.css     → Styles
```

The server opens the database **read-only** by default. Writes require `--write`
(or `OCV_WRITE=1`), which opens it read-write and enables foreign keys so deletes
cascade. Write requests return `403` when edit mode is off.

Reads:
- `GET /api/projects` — list all projects
- `GET /api/projects/:id/sessions?page=&limit=&q=&scope=` — paginated / searchable sessions
- `GET /api/sessions/search?q=&scope=&page=&limit=` — global session search
- `GET /api/sessions/:id` — session detail with messages + parts
- `GET /api/sessions/:id/subagents` — subagent sessions
- `GET /api/parts/:id/image` — base64 image extraction from part data
- `GET /api/events` — OpenCode event-log stats (total/orphaned events and aggregates)

Writes (JSON body):
- `POST /api/projects` · `PATCH|PUT /api/projects/:id` · `DELETE /api/projects/:id`
- `POST /api/sessions` · `PATCH|PUT /api/sessions/:id` · `DELETE /api/sessions/:id`
- `POST /api/sessions/:id/messages` · `PATCH|PUT /api/messages/:id` · `DELETE /api/messages/:id`
- `POST /api/messages/:id/parts` · `PATCH|PUT /api/parts/:id` · `DELETE /api/parts/:id`
- `POST /api/vacuum` · `POST /api/checkpoint` · `POST /api/bulk-delete` · `POST /api/purge-events`

IDs are generated server-side with typed prefixes (`proj_`, `ses_`, `msg_`, `prt_`) when omitted. Updates only apply whitelisted columns and auto-bump `time_updated`.

Deleting a session or project also purges its OpenCode event-sourcing log rows (`event` / `event_sequence`).
OpenCode's append-only `event` table is not foreign-keyed to `session`, so events for sessions deleted
elsewhere linger; `POST /api/purge-events` (and the header "Reclaim" flow) removes those orphaned
aggregates so a following VACUUM can shrink the file.

The frontend is self-contained in `public/` — it fetches from the API and renders three panels with client-side state management.

## Design System

Uses the Koomi KB Redesign design language:
- **Font**: Geist + Geist Mono (Google Fonts)
- **Palette**: Warm cream (`#fbfaf7` bg, `#f5f4f0` surfaces, `#e8e6df` borders)
- **Accent**: Teal via `oklch(0.62 0.11 185)`
- **CSS variables**: `--bg`, `--surface`, `--ink`, `--hair`, `--accent`, `--font-sans`, `--font-mono`

## Running

```bash
bun run dev            # dev mode with watch (server/launch.ts)
bun run start          # production (server/launch.ts)
bun run dev -- --write # enable edit mode
bunx @homescriptone/opencode-viewer-extender   # via CLI (default port 3456, auto-opens browser)
```

Default port `3456` when launched via the CLI; running `server/launch.ts` directly picks a random port unless `OCV_PORT` is set. Set `OCV_PORT`, `OCV_DB_PATH`, or `OCV_WRITE=1` to override.

## Conventions

- No dependencies beyond Bun built-ins
- Keep everything in minimal files — avoid splitting unless necessary
- All SQL queries use prepared statements
- Server code lives in `server/`; `database.ts` owns the DB and shared helpers, `launch.ts` owns HTTP routing
