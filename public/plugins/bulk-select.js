// Bulk select plugin: select multiple projects and sessions, then export them
// as a single .zip or delete them (project deletes cascade).
//
// The archive is grouped into folders and each item is written in three
// formats: JSON (.json), XML (.xml) and a standalone HTML page (.html).
//
//   manifest.json
//   projects/<project>/
//     project.json  project.xml  project.html
//     sessions/<session>/
//       session.json  session.xml  session.html
//   sessions/<session>/            (directly-selected sessions)
//     session.json  session.xml  session.html

OCV.define({
  id: "bulk-select",
  name: "Bulk select · export & delete",
  description: "Select multiple projects and sessions to export as a .zip (json/xml/html) or delete.",

  setup(api) {
    api.registerBulkAction({
      id: "bulk-export-zip",
      label: "Export selected (.zip)",
      async handler({ projectIds, sessionIds, host }) {
        const entries = [];
        const seenSessions = new Set();
        const projectsById = new Map(host.getProjects().map((project) => [project.id, project]));

        try {
          host.setStatus("Preparing export…");

          const tasks = [];
          for (const projectId of projectIds) {
            const project = projectsById.get(projectId) || { id: projectId };
            const folderName = sanitize(`${project.name || projectId}-${projectId}`);
            const base = `projects/${folderName}`;

            entries.push({ name: `${base}/project.json`, data: JSON.stringify(project, null, 2) });
            entries.push({ name: `${base}/project.xml`, data: toXmlDocument("project", project) });
            entries.push({ name: `${base}/project.html`, data: toProjectHtml(project) });

            const sessions = await host.api.getProjectSessions(projectId);
            for (const session of sessions) {
              if (seenSessions.has(session.id)) continue;
              seenSessions.add(session.id);
              tasks.push({ sessionId: session.id, folder: `${base}/sessions/${sanitize(session.id)}` });
            }
          }

          for (const sessionId of sessionIds) {
            if (seenSessions.has(sessionId)) continue;
            seenSessions.add(sessionId);
            tasks.push({ sessionId, folder: `sessions/${sanitize(sessionId)}` });
          }

          const total = tasks.length;
          let done = 0;
          if (total === 0) {
            host.setStatus("Building archive…");
          } else {
            host.setProgress(0, total, "Collecting sessions…");
          }

          for (const task of tasks) {
            const detail = await host.api.getSessionDetail(task.sessionId);
            const title = detail?.session?.title || task.sessionId;
            entries.push({ name: `${task.folder}/session.json`, data: JSON.stringify(detail, null, 2) });
            entries.push({ name: `${task.folder}/session.xml`, data: toXmlDocument("export", detail) });
            entries.push({ name: `${task.folder}/session.html`, data: toHtmlDocument(title, detail) });
            done += 1;
            host.setProgress(done, total, "Collecting sessions…");
          }

          host.setStatus("Building archive…");
          entries.push({
            name: "manifest.json",
            data: JSON.stringify(
              {
                exportedAt: new Date().toISOString(),
                formats: ["json", "xml", "html"],
                projectIds,
                sessionIds,
                files: entries.length + 1
              },
              null,
              2
            )
          });

          const blob = host.createZip(entries);
          host.download(`ocv-export-${Date.now()}.zip`, blob, "application/zip");
          host.notify(`Exported ${entries.length} files (json/xml/html).`);
        } finally {
          host.clearStatus();
        }
      }
    });

    api.registerBulkAction({
      id: "bulk-delete",
      label: "Delete selected",
      danger: true,
      write: true,
      async handler({ projectIds, sessionIds, host }) {
        const parts = [];
        if (projectIds.length) parts.push(`${projectIds.length} project(s) (and all their sessions)`);
        if (sessionIds.length) parts.push(`${sessionIds.length} session(s)`);
        if (!parts.length) return;

        const ok = window.confirm(`Delete ${parts.join(" and ")}? This cannot be undone.`);
        if (!ok) return;

        const total = projectIds.length + sessionIds.length;
        try {
          host.setStatus(`Deleting ${total} item(s)…`);
          if (typeof host.api.bulkDelete === "function") {
            await host.api.bulkDelete(projectIds, sessionIds);
          } else {
            for (const projectId of projectIds) await host.api.deleteProject(projectId);
            for (const sessionId of sessionIds) await host.api.deleteSession(sessionId);
          }
        } finally {
          host.clearStatus();
        }

        host.clearSelection();
        host.refresh();
        host.notify(`Deleted ${total} item(s).`);
      }
    });
  }
});

function sanitize(value) {
  return (
    String(value ?? "item")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "item"
  );
}

function xmlEscape(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function xmlTag(name) {
  const clean = String(name).replace(/[^a-zA-Z0-9_.-]/g, "_");
  return /^[a-zA-Z_]/.test(clean) ? clean : `_${clean}`;
}

function jsonToXml(name, value, indent) {
  const pad = `${indent}  `;
  if (value === null || value === undefined) return `${indent}<${name}/>`;
  if (Array.isArray(value)) {
    if (!value.length) return `${indent}<${name}/>`;
    const inner = value.map((item) => jsonToXml("item", item, pad)).join("\n");
    return `${indent}<${name}>\n${inner}\n${indent}</${name}>`;
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (!keys.length) return `${indent}<${name}/>`;
    const inner = keys.map((key) => jsonToXml(xmlTag(key), value[key], pad)).join("\n");
    return `${indent}<${name}>\n${inner}\n${indent}</${name}>`;
  }
  return `${indent}<${name}>${xmlEscape(value)}</${name}>`;
}

function toXmlDocument(rootName, value) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${jsonToXml(rootName, value, "")}\n`;
}

function htmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stringify(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const PAGE_CSS = `
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0 auto; max-width: 900px; padding: 32px 20px; color: #1c1b18; background: #fbfaf7; line-height: 1.55; }
  h1 { font-size: 1.6rem; margin: 0 0 4px; }
  h2 { font-size: 1.1rem; margin: 28px 0 8px; padding-top: 12px; border-top: 1px solid #e8e6df; }
  h3 { font-size: 0.95rem; margin: 16px 0 4px; }
  .meta { color: #6f6d66; font-size: 0.85rem; margin: 0 0 8px; }
  .part { margin: 10px 0; }
  pre { background: #f5f4f0; border: 1px solid #e8e6df; border-radius: 8px; padding: 12px; overflow-x: auto; font-size: 0.85rem; white-space: pre-wrap; word-break: break-word; }
  details { border: 1px solid #e8e6df; border-radius: 8px; padding: 8px 12px; }
  summary { cursor: pointer; font-weight: 600; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
  .role-user h2 { color: oklch(0.38 0.08 185); }
`;

function toProjectHtml(project) {
  const title = project?.name || project?.id || "Project";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${htmlEscape(title)}</title><style>${PAGE_CSS}</style></head>
<body>
<h1>${htmlEscape(title)}</h1>
<p class="meta">${htmlEscape(project?.worktree || "")}</p>
<pre>${htmlEscape(JSON.stringify(project, null, 2))}</pre>
</body></html>
`;
}

function renderPartHtml(part) {
  const type = String(part?.type ?? "text");
  if (type === "text" || type === "reasoning") {
    const label = type === "reasoning" ? `<h3>Reasoning</h3>` : "";
    return `${label}<div class="part"><pre>${htmlEscape(stringify(part.text).trim())}</pre></div>`;
  }
  if (type === "tool") {
    const output = part.state && part.state.output !== undefined ? stringify(part.state.output) : "";
    return `<div class="part"><details><summary>Tool: ${htmlEscape(String(part.tool ?? "unknown"))}</summary>
<pre>${htmlEscape(stringify(part.state && part.state.input) || "{}")}</pre>
${output ? `<pre>${htmlEscape(output)}</pre>` : ""}
</details></div>`;
  }
  if (type === "patch") {
    return `<div class="part"><h3>Patch <code>${htmlEscape(String(part.hash ?? "").slice(0, 7))}</code></h3></div>`;
  }
  if (type === "file") {
    return `<div class="part"><h3>File: ${htmlEscape(String(part.filename ?? "attachment"))}</h3></div>`;
  }
  return "";
}

function toHtmlDocument(title, detail) {
  const session = detail?.session ?? {};
  const messages = Array.isArray(detail?.messages) ? detail.messages : [];
  const updated = Number(session.time_updated);
  const meta = [
    `ID: ${session.id ?? ""}`,
    session.directory ? `Directory: ${session.directory}` : "",
    Number.isFinite(updated) && updated > 0 ? `Updated: ${new Date(updated).toISOString()}` : ""
  ]
    .filter(Boolean)
    .map(htmlEscape)
    .join(" · ");

  const body = messages
    .map((message) => {
      if (message._type === "subagent") {
        return `<h2>Subagent: ${htmlEscape(message.title || message.id)}</h2>`;
      }
      const role = String(message.role ?? "unknown");
      const parts = (message.parts ?? []).map(renderPartHtml).join("\n");
      const model = message.modelID ? `<div class="meta">model: ${htmlEscape(message.modelID)}</div>` : "";
      return `<div class="role-${htmlEscape(role)}"><h2>${htmlEscape(role)}</h2>${model}${parts}</div>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${htmlEscape(title)}</title><style>${PAGE_CSS}</style></head>
<body>
<h1>${htmlEscape(title)}</h1>
<p class="meta">${meta}</p>
${body}
</body></html>
`;
}
