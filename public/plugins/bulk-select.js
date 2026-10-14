// Bulk select plugin: select multiple projects and sessions, then export them
// as a single .zip of JSON files or delete them (project deletes cascade).

OCV.define({
  id: "bulk-select",
  name: "Bulk select · export & delete",
  description: "Select multiple projects and sessions to export as a .zip or delete.",

  setup(api) {
    api.registerBulkAction({
      id: "bulk-export-zip",
      label: "Export selected (.zip)",
      async handler({ projectIds, sessionIds, host }) {
        const entries = [];
        const seenSessions = new Set();
        const projectsById = new Map(host.getProjects().map((project) => [project.id, project]));

        const addSession = async (sessionId, folder) => {
          if (seenSessions.has(sessionId)) return;
          seenSessions.add(sessionId);
          const detail = await host.api.getSessionDetail(sessionId);
          entries.push({ name: `${folder}/${sessionId}.json`, data: JSON.stringify(detail, null, 2) });
        };

        for (const projectId of projectIds) {
          const project = projectsById.get(projectId);
          const folderName = sanitize(`${project?.name || projectId}-${projectId}`);
          entries.push({
            name: `projects/${folderName}/project.json`,
            data: JSON.stringify(project ?? { id: projectId }, null, 2)
          });
          const sessions = await host.api.getProjectSessions(projectId);
          for (const session of sessions) {
            await addSession(session.id, `projects/${folderName}/sessions`);
          }
        }

        for (const sessionId of sessionIds) {
          await addSession(sessionId, "sessions");
        }

        entries.push({
          name: "manifest.json",
          data: JSON.stringify(
            { exportedAt: new Date().toISOString(), projectIds, sessionIds, files: entries.length + 1 },
            null,
            2
          )
        });

        const blob = host.createZip(entries);
        host.download(`ocv-export-${Date.now()}.zip`, blob, "application/zip");
        host.notify(`Exported ${entries.length} files.`);
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

        let deleted = 0;
        for (const projectId of projectIds) {
          await host.api.deleteProject(projectId);
          deleted += 1;
        }
        for (const sessionId of sessionIds) {
          await host.api.deleteSession(sessionId);
          deleted += 1;
        }

        host.clearSelection();
        host.refresh();
        host.notify(`Deleted ${deleted} item(s).`);
      }
    });
  }
});

function sanitize(value) {
  return String(value ?? "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "item";
}
