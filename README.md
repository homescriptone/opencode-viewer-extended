# opencode-viewer-extender

[![npm](https://img.shields.io/npm/v/@homescriptone/opencode-viewer-extender.svg)](https://www.npmjs.com/package/@homescriptone/opencode-viewer-extender)
[![license](https://img.shields.io/npm/l/@homescriptone/opencode-viewer-extender.svg)](LICENSE)

Local GUI to **browse, edit, and export** your [OpenCode](https://opencode.ai) sessions, messages, and tool calls from the SQLite database — with a small **plugin API** you can extend.

Reads and writes `~/.local/share/opencode/opencode.db`. Everything stays on your machine.

```bash
bunx @homescriptone/opencode-viewer-extender
```

> On npm: [`@homescriptone/opencode-viewer-extender`](https://www.npmjs.com/package/@homescriptone/opencode-viewer-extender).

## Features

- **Three-panel UI** — projects, sessions, and the full message thread
- **Every part type rendered** — text (markdown-lite), reasoning, tool calls with input/output, patches, file attachments, images (click-to-expand), agent pills, step-finish costs, compaction markers
- **Subagents** — interleaved in the timeline; click to drill in, back to return
- **Search** — cross-project session search scoped to all / user / model messages
- **Export** — a session as Markdown or JSON, or **select many** projects/sessions and export a single `.zip`
- **Edit mode** — opt-in create/update/delete (projects, sessions, messages, parts)
- **Plugins** — drop a `.js` file in `public/plugins/` to add renderers, export formats, and bulk actions; toggle them on/off from the UI

## Requirements

- [Bun](https://bun.sh) runtime (`curl -fsSL https://bun.sh/install | bash`)
- [OpenCode](https://opencode.ai) installed and used at least once

## Usage

```bash
# Run it (auto-opens the browser)
bunx @homescriptone/opencode-viewer-extender

# Custom port
bunx @homescriptone/opencode-viewer-extender -p 8080

# Custom database path
bunx @homescriptone/opencode-viewer-extender --db /path/to/opencode.db

# Enable edit mode (create/update/delete)
bunx @homescriptone/opencode-viewer-extender --write

# Don't open the browser
bunx @homescriptone/opencode-viewer-extender --no-open
```

Default port is `3456` when launched via the CLI. Set `OCV_PORT`, `OCV_DB_PATH`, or `OCV_WRITE=1` to override.

## Edit mode

The database is opened **read-only** by default. Writes only become available when you start with `--write` (or `OCV_WRITE=1`); the server then exposes the write API and the UI shows an **Edit** toggle.

> **Warning:** edits and deletes hit your real OpenCode database, and deletes **cascade** (deleting a project removes its sessions, messages, and parts). There is no undo. Back up `opencode.db` before making changes.

## Export

- **Single session** — the **Export ▾** menu in the message header offers Markdown (`.md`) and JSON (`.json`), served by `GET /api/sessions/:id/export?format=md|json`.
- **Bulk** — turn on **Select**, pick multiple projects/sessions, and choose **Export selected (.zip)**. The archive is grouped into folders, and every item is written in three formats (`.json`, `.xml`, `.html`):

  ```
  manifest.json
  projects/<project>/project.{json,xml,html}
  projects/<project>/sessions/<session>/session.{json,xml,html}
  sessions/<session>/session.{json,xml,html}    # directly-selected sessions
  ```

## Plugins

Plugins are plain ES scripts discovered at startup from `public/plugins/` (listed by `GET /api/plugins`) and loaded before the UI renders. Enable/disable them from the **Plugins** button; disabled plugins are remembered in `localStorage`.

See [`public/plugins/example.js`](public/plugins/example.js) for a complete example.

### Authoring

```js
OCV.define({
  id: "my-plugin",
  name: "My plugin",
  description: "What it does",

  setup(api) {
    // Render a custom part type -> HTML string (return falsy to fall back)
    api.registerPartRenderer("snapshot", (part, helpers) => `...`);

    // Add an export format to the Export menu (built in the browser)
    api.registerExportFormat({
      id: "txt", label: "Plain text (.txt)", extension: "txt", mime: "text/plain",
      build: ({ session, messages }) => "..."
    });

    // Add a button in the session header
    api.registerSessionAction({ id: "copy", label: "Copy ID", handler: ({ session }) => {} });

    // Add a bulk action shown when items are selected
    api.registerBulkAction({
      id: "wipe", label: "Delete selected", danger: true, write: true, // write:true => only in Edit mode
      handler: async ({ projectIds, sessionIds, host }) => { /* ... */ }
    });
  }
});
```

Every `register*` call returns an unregister function, and registrations are removed automatically when the plugin is disabled.

### Host bridge

`api.host` (also `OCV.host`) exposes data and actions:

```js
host.getProjects()                       // [{ id, name, worktree }]
host.getSessions()                       // current session list
host.getSelection()                      // { projectIds, sessionIds }
host.clearSelection()
host.api.getProjectSessions(projectId)   // all sessions for a project
host.api.getSessionDetail(sessionId)     // { session, messages }
host.api.deleteProject(id)
host.api.deleteSession(id)
host.download(name, content, mime)       // save a Blob/string
host.createZip([{ name, data }])         // -> Blob (store method, no deps)
host.refresh()                           // reload projects/sessions
```

## How it works

```
bin/cli.ts            → CLI args, env setup, opens the browser
server/launch.ts      → Bun.serve HTTP server, routing, static files, export
server/database.ts    → SQLite connection, prepared statements, write layer
public/index.html     → Page shell (loads plugin-api.js + script.js)
public/script.js      → Single-page app (vanilla JS, no framework)
public/plugin-api.js  → window.OCV plugin registry (+ zip helper)
public/plugins/*.js   → Drop-in plugins
public/styles.css     → Styles
```

1. Opens `opencode.db` (read-only unless `--write`).
2. Starts a Bun server on `localhost:3456`.
3. Serves the static SPA and a small JSON REST API.
4. All data stays local — nothing leaves your machine.

### REST API

Reads: `GET /api/projects` · `GET /api/projects/:id/sessions` · `GET /api/sessions/search` · `GET /api/sessions/:id` · `GET /api/sessions/:id/subagents` · `GET /api/sessions/:id/export` · `GET /api/parts/:id/image` · `GET /api/plugins` · `GET /api/config`

Writes (require `--write`): `POST/PATCH/PUT/DELETE` on `/api/projects`, `/api/sessions`, `/api/sessions/:id/messages`, `/api/messages/:id/parts`.

## Development

```bash
bun run dev     # watch mode (server/launch.ts)
bun run start   # production
bun run typecheck
```

## Releasing

Publishing uses npm **trusted publishing (OIDC)** — no tokens or secrets. Push a version tag:

```bash
git tag v1.3.0 && git push origin v1.3.0
```

[`.github/workflows/publish.yml`](.github/workflows/publish.yml) then type-checks and runs `npm publish` with provenance.

One-time setup on [npmjs.com](https://www.npmjs.com): open the package → **Settings** → **Trusted Publisher** → **GitHub Actions**, and set the repository (`homescriptone/opencode-viewer-extended`) and workflow filename (`publish.yml`). No `NPM_TOKEN` secret is required.

## Credits

Maintained by [homescriptone Solutions Ltd](https://github.com/homescriptone). Built on
[opencode-viewer](https://github.com/leeweisern/opencode-viewer) by its original author
[leeweisern](https://github.com/leeweisern) — thank you.

## License

MIT © 2026 homescriptone Solutions Ltd. See [LICENSE](LICENSE).
