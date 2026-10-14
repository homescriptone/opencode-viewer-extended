// Example OCV plugin (API v2).
// Drop any .js file into public/plugins/ and it is auto-loaded at startup.
//
// A plugin calls OCV.define({ id, name, description, setup(api), teardown? }).
// setup() registers features and returns nothing; every register* call returns
// an unregister function, and disabled plugins are torn down automatically.
//
// api registration hooks:
//   api.registerPartRenderer(type, renderer)  renderer(part, helpers) -> HTML
//   api.registerExportFormat({ id, label, extension, mime, build })
//   api.registerSessionAction({ id, label, handler })
//   api.registerBulkAction({ id, label, danger?, handler })
//
// api.host exposes host data/actions:
//   host.getProjects(), host.getSessions(), host.getSelection()
//   host.api.getProjectSessions(id), host.api.getSessionDetail(id)
//   host.api.deleteProject(id), host.api.deleteSession(id)
//   host.download(name, content, mime), host.createZip(entries), host.refresh()

OCV.define({
  id: "example",
  name: "Example plugin",
  description: "Demonstrates the plugin hooks: snapshot renderer, text export, copy session ID.",

  setup(api) {
    // 1. Custom part renderer: surface "snapshot" parts (hidden by default).
    api.registerPartRenderer("snapshot", function (part, helpers) {
      const hash = String(part.hash ?? part.snapshot ?? "").slice(0, 12);
      if (!hash) return "";
      return `<div class="part part-snapshot"><span class="tiny-muted">snapshot</span> <code>${helpers.escapeHtml(hash)}</code></div>`;
    });

    // 2. Custom export format: plain text transcript.
    api.registerExportFormat({
      id: "example-txt",
      label: "Plain text (.txt) — example",
      extension: "txt",
      mime: "text/plain",
      build(ctx) {
        const lines = [];
        lines.push(ctx.session?.title || "Session");
        lines.push("");
        for (const message of ctx.messages ?? []) {
          if (message._type === "subagent") {
            lines.push(`[subagent] ${message.title || message.id}`);
            continue;
          }
          lines.push(`## ${message.role || "unknown"}`);
          for (const part of message.parts ?? []) {
            if (typeof part.text === "string" && part.text.trim()) lines.push(part.text.trim());
            else if (part.type === "tool") lines.push(`[tool: ${part.tool ?? "unknown"}]`);
          }
          lines.push("");
        }
        return lines.join("\n");
      }
    });

    // 3. Custom session action: copy the session id.
    api.registerSessionAction({
      id: "example-copy-id",
      label: "Copy session ID",
      handler(ctx) {
        if (ctx.session?.id && navigator.clipboard) {
          navigator.clipboard.writeText(String(ctx.session.id));
        }
      }
    });
  },

  teardown() {
    // registrations returned by api.register* are removed automatically;
    // release any listeners/timers here if needed.
  }
});
