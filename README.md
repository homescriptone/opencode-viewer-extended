# opencode-viewer-extender

[![npm](https://img.shields.io/npm/v/@homescriptone/opencode-viewer-extender.svg)](https://www.npmjs.com/package/@homescriptone/opencode-viewer-extender)
[![license](https://img.shields.io/npm/l/@homescriptone/opencode-viewer-extender.svg)](LICENSE)

A local web GUI to **browse, search, edit, and export** your [OpenCode](https://opencode.ai) AI coding sessions. It reads from and writes to the OpenCode SQLite database (`~/.local/share/opencode/opencode.db`) and stays entirely on your machine.

Runs with a single command:

```bash
bunx @homescriptone/opencode-viewer-extender
```

> Available on npm: [`@homescriptone/opencode-viewer-extender`](https://www.npmjs.com/package/@homescriptone/opencode-viewer-extender).

## Features

- **Three-panel UI** — Browse projects, sessions, and the full message thread in one view.
- **Rich message rendering** — Renders text (Markdown), reasoning, tool calls (with inputs/outputs), patches, file attachments, images (click to expand), agent pills, step-finish costs, and compaction markers.
- **Subagents** — Subagent sessions are interleaved in the timeline. Click to drill into a subagent run, and use "Back" to return.
- **Powerful search** — Global cross-project session search with scope filters (all / user / assistant/model messages).
- **Flexible export** — Export a single session as Markdown or JSON, or select multiple projects/sessions and export everything as a single `.zip` (with JSON, XML, and HTML per item).
- **Opt-in edit mode** — Safely create, update, or delete projects, sessions, messages, and parts when explicitly enabled.
- **Extensible via plugins** — Drop `.js` files in `public/plugins/` to add custom part renderers, export formats, session actions, or bulk actions. Toggle plugins on/off in the UI.
- **Local-first** — No network requests leave your machine. All data comes directly from your local OpenCode database.

## Requirements

- [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)
- [OpenCode](https://opencode.ai) installed and used at least once

## Quick Start

```bash
# Run and auto-open in your browser
bunx @homescriptone/opencode-viewer-extender
```

The app will open at `http://localhost:3456` by default.

## Usage

```bash
# Custom port
bunx @homescriptone/opencode-viewer-extender -p 8080

# Custom database path
bunx @homescriptone/opencode-viewer-extender --db /path/to/opencode.db

# Enable edit mode (create/update/delete)
bunx @homescriptone/opencode-viewer-extender --write

# Don't auto-open the browser
bunx @homescriptone/opencode-viewer-extender --no-open
```

### Environment Variables

You can also configure via environment variables instead of CLI flags:

| Variable | Purpose | Default |
|---|---|---|
| `OCV_PORT` | Server port | `3456` (CLI), random (direct `server/launch.ts`) |
| `OCV_DB_PATH` | Path to OpenCode SQLite DB | `~/.local/share/opencode/opencode.db` |
| `OCV_WRITE` | Enable edit mode (`1`/`true`) | `0` |

## Edit Mode

By default, the database is opened **read-only**. Write operations are only available when started with `--write` (or `OCV_WRITE=1`). When enabled, the server exposes the write API and the UI shows an **Edit** toggle.

> ⚠️ **Safety warning:** Edits and deletes apply to your real OpenCode database. Deletions **cascade** (deleting a project removes its sessions, messages, and parts). **There is no undo.** Back up `opencode.db` before making changes.

## Reclaiming Database Space (Vacuum)

SQLite reuses freed pages after deletes instead of shrinking the database file. With edit mode enabled, a **Reclaim** button appears in the Projects header. It shows reclaimable space and automatically chooses the best strategy:

- **If not in incremental auto-vacuum** — Runs a one-time full rewrite (`VACUUM`) to convert to incremental auto-vacuum. After conversion, space is reclaimed in fast, resumable ~200 MB steps.
- **If already in incremental auto-vacuum** — Reclaims space immediately in ~200 MB steps (`PRAGMA incremental_vacuum`).

These operations are also available via HTTP: `GET /api/db` reports DB size and free pages, and `POST /api/vacuum` accepts `{ "mode": "full" | "convert" | "step", "mb": 200 }`.

**Notes:**

- A full `VACUUM` rewrite requires free disk space roughly equal to the current DB size and can take time on large databases.
- If OpenCode is currently running, it may hold a lock on the database — quit OpenCode first for safest results.
- The app uses WAL journaling. Heavy writes grow a `-wal` file that isn't fully reclaimed until a checkpoint. After reclaims or bulk deletes, it runs `PRAGMA wal_checkpoint(TRUNCATE)` (also exposed as `POST /api/checkpoint`) and sets `PRAGMA journal_size_limit` to prevent unbounded WAL growth.

## Export

### Single Session

In the message header, open the **Export ▾** menu to download a session as:
- **Markdown** (`.md`) — Human-readable export
- **JSON** (`.json`) — Machine-readable, preserves full structure

Served by `GET /api/sessions/:id/export?format=md|json`.

### Bulk Export (.zip)

Enable **Select** mode, choose projects/sessions (or **All projects** / **All sessions**), then select **Export selected (.zip)**. A progress indicator shows for larger exports.

The archive is organized as follows:

```text
manifest.json
projects/<project>/project.{json,xml,html}
projects/<project>/sessions/<session>/session.{json,xml,html}
sessions/<session>/session.{json,xml,html}    # directly-selected sessions
```

Each item is exported in **three formats** (`.json`, `.xml`, `.html`) for maximum compatibility.

## Plugins

Plugins are plain ES modules discovered from `public/plugins/` at startup (`GET /api/plugins`). Enable/disable them from the **Plugins** button — disabled plugins are remembered in `localStorage`.

See [`public/plugins/example.js`](public/plugins/example.js) for a complete working example.

### Authoring Plugins

```js
OCV.define({
  id: "my-plugin",
  name: "My Plugin",
  description: "What it does",

  setup(api) {
    // Render a custom part type -> HTML string (return falsy to fall back)
    api.registerPartRenderer("snapshot", (part, helpers) => `...`);

    // Add an export format to the Export menu (runs in the browser)
    api.registerExportFormat({
      id: "txt",
      label: "Plain text (.txt)",
      extension: "txt",
      mime: "text/plain",
      build: ({ session, messages }) => "..."
    });

    // Add a button in the session header
    api.registerSessionAction({
      id: "copy",
      label: "Copy ID",
      handler: ({ session }) => {}
    });

    // Add a bulk action shown when items are selected
    api.registerBulkAction({
      id: "wipe",
      label: "Delete selected",
      danger: true,
      write: true, // only shown/enabled in Edit mode
      handler: async ({ projectIds, sessionIds, host }) => { /* ... */ }
    });
  }
});
```

Every `register*` call returns an `unregister()` function. Registrations are automatically removed when the plugin is disabled.

### Host Bridge

`api.host` (also `OCV.host`) exposes data and actions for plugins:

```js
host.getProjects()                       // [{ id, name, worktree }]
host.getSessions()                       // current session list
host.getSelection()                      // { projectIds, sessionIds }
host.clearSelection()
host.api.getProjectSessions(projectId)   // all sessions for a project
host.api.getSessionDetail(sessionId)     // { session, messages }
host.api.deleteProject(id)
host.api.deleteSession(id)
host.download(name, content, mime)       // download Blob/string
host.createZip([{ name, data }])         // -> Blob (no external deps)
host.refresh()                           // reload projects/sessions
```

## How It Works

```text
bin/cli.ts            → CLI args, env setup, auto-opens browser
server/launch.ts      → Bun.serve HTTP server, routing, static files, exports
server/database.ts    → SQLite connection, prepared statements, write layer
public/index.html     → Page shell (loads plugin-api.js + script.js)
public/script.js      → Single-page app (vanilla JS, no framework)
public/plugin-api.js  → window.OCV plugin registry (+ ZIP helper)
public/plugins/*.js   → Drop-in plugins
public/styles.css     → Styles
```

1. Opens `opencode.db` (read-only unless `--write`).
2. Starts a Bun HTTP server on `localhost:3456` (or configured port).
3. Serves the static SPA and a small JSON REST API.
4. All data stays local — nothing leaves your machine.

## REST API

### Reads (always available)

- `GET /api/projects` — List all projects
- `GET /api/projects/:id/sessions?page=&limit=&q=&scope=` — Paginated/searchable sessions for a project
- `GET /api/sessions/search?q=&scope=&page=&limit=` — Global session search
- `GET /api/sessions/:id` — Session detail (session + messages + parts)
- `GET /api/sessions/:id/subagents` — Subagent sessions for a parent session
- `GET /api/sessions/:id/export?format=md|json` — Export a single session
- `GET /api/parts/:id/image` — Extract base64 image from part data
- `GET /api/events` — OpenCode event-log stats (totals, orphaned events, aggregates)
- `GET /api/plugins` — List discovered plugins
- `GET /api/config` — Server/config metadata
- `GET /api/db` — Database size and reclaimable/free pages

### Writes (require `--write`/edit mode)

- **Projects**: `POST /api/projects`, `PATCH /api/projects/:id`, `PUT /api/projects/:id`, `DELETE /api/projects/:id`
- **Sessions**: `POST /api/sessions`, `PATCH /api/sessions/:id`, `PUT /api/sessions/:id`, `DELETE /api/sessions/:id`
- **Messages**: `POST /api/sessions/:id/messages`, `PATCH /api/messages/:id`, `PUT /api/messages/:id`, `DELETE /api/messages/:id`
- **Parts**: `POST /api/messages/:id/parts`, `PATCH /api/parts/:id`, `PUT /api/parts/:id`, `DELETE /api/parts/:id`
- **Maintenance**: `POST /api/vacuum`, `POST /api/checkpoint`, `POST /api/bulk-delete`, `POST /api/purge-events`

IDs are generated server-side with typed prefixes (`proj_`, `ses_`, `msg_`, `prt_`) when omitted. Updates only apply whitelisted columns and auto-bump `time_updated`. Deletions cascade and also purge related OpenCode event log rows (`event`/`event_sequence`); `POST /api/purge-events` removes orphaned events left by external deletions.

## Development

```bash
# Watch mode (auto-reloads on changes)
bun run dev

# Production mode
bun run start

# Enable edit mode in dev
bun run dev -- --write

# Type check
bun run typecheck
```

## Releasing

This repo uses **npm Trusted Publishing (OIDC)** and is fully automated with [release-please](https://github.com/googleapis/release-please-action).

### How it works

1. **Commit with Conventional Commits** — Use `feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `perf:`, or `BREAKING CHANGE:` in your commit messages.
2. **Merge to `main`** — release-please automatically opens (or updates) a **Release PR** that bumps `package.json`, updates `CHANGELOG.md`, and prepares the next semantic version.
3. **Merge the Release PR** — release-please creates a GitHub Release and pushes the version tag (`vX.Y.Z`).
4. **Auto-publish to npm** — `.github/workflows/publish.yml` triggers on `release: published` and runs `bun check`, optional build/test, and `npm publish --provenance --access public`.

No manual tag pushing is required for normal releases.

### One-time setup (npm)

**npm Trusted Publisher:** Go to [npmjs.com](https://www.npmjs.com) → Package → Settings → Trusted Publisher → GitHub Actions. Set repository `homescriptone/opencode-viewer-extender` and workflow `publish.yml`. No `NPM_TOKEN` secret is needed.

### Manual fallback (if needed)

If you ever need to release manually, push a semantic version tag. The publish workflow also supports `workflow_dispatch`, but the automated path is preferred.

```bash
git tag v1.4.0
git push origin v1.4.0
```

## Contributing

**Pull requests are welcome and encouraged!** Bug fixes, features, documentation improvements, and new plugins are all appreciated.

1. Fork the repo and create a feature branch.
2. Run `bun run dev` while developing.
3. Run `bun run typecheck` before opening your PR to ensure type correctness.
4. Keep PRs focused and clearly describe what changed and why.

Questions, ideas, or bug reports are welcome — open an issue at [github.com/homescriptone/opencode-viewer-extended/issues](https://github.com/homescriptone/opencode-viewer-extended/issues).

## Credits

Maintained by [homescriptone Solutions Ltd](https://github.com/homescriptone). Built on [opencode-viewer](https://github.com/leeweisern/opencode-viewer) by [leeweisern](https://github.com/leeweisern) — thank you.

## License

MIT © 2026 homescriptone Solutions Ltd. See [LICENSE](LICENSE).
