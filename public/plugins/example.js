// Example OCV plugin.
// Drop any .js file into public/plugins/ and it is auto-loaded at startup.
//
// The global `OCV` API exposes three hooks:
//   OCV.registerPartRenderer(type, renderer)   render a message part type yourself
//       renderer(part, helpers) -> HTML string (or falsy to fall back to built-in)
//   OCV.registerExportFormat({ id, label, extension, mime, build })
//       build({ session, messages, state }) -> string, shown in the Export menu
//   OCV.registerSessionAction({ id, label, handler })
//       handler({ session, messages, state }) -> void, shown as a header button

(function () {
  if (!window.OCV) return;

  // 1. Custom part renderer: surface "snapshot" parts (hidden by default).
  OCV.registerPartRenderer("snapshot", function (part, helpers) {
    const hashRaw = part.hash ?? part.snapshot ?? "";
    const hash = String(hashRaw).slice(0, 12);
    if (!hash) return "";
    return `<div class="part part-snapshot"><span class="tiny-muted">snapshot</span> <code>${helpers.escapeHtml(hash)}</code></div>`;
  });

  // 2. Custom export format: plain text transcript.
  OCV.registerExportFormat({
    id: "example-txt",
    label: "Plain text (.txt) — example",
    extension: "txt",
    mime: "text/plain",
    build: function (ctx) {
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
    },
  });

  // 3. Custom session action: copy the session id.
  OCV.registerSessionAction({
    id: "example-copy-id",
    label: "Copy session ID",
    handler: function (ctx) {
      if (ctx.session?.id && navigator.clipboard) {
        navigator.clipboard.writeText(String(ctx.session.id));
      }
    },
  });
})();
