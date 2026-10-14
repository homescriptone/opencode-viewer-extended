    const state = {
      projects: [],
      projectsLoading: false,
      projectsError: null,

      selectedProjectId: null,
      sessions: [],
      sessionsLoading: false,
      sessionsLoadingMore: false,
      sessionsError: null,
      sessionsPage: 1,
      sessionsLimit: 50,
      sessionsHasMore: false,
      sessionsTotal: null,
      sessionsQuery: "",
      sessionsScope: "all",

      selectedSessionId: null,
      sessionLoading: false,
      sessionError: null,
      sessionData: null,
      messages: [],
      messageOutlineCollapsed: false,
      sessionStack: [],
      exportMenuOpen: false,
      selectMode: false,
      selectedProjectIds: new Set(),
      selectedSessionIds: new Set(),
      pluginsOpen: false
    };

    const el = {
      projects: document.getElementById("projects-panel"),
      sessions: document.getElementById("sessions-panel"),
      messages: document.getElementById("messages-panel"),
      bulkBar: document.getElementById("bulk-bar"),
      modal: document.getElementById("modal-root")
    };

    let projectsRequestId = 0;
    let sessionsRequestId = 0;
    let sessionRequestId = 0;
    let toolResultCounter = 0;
    let sessionsSearchDebounceTimer = null;

    function escapeHtml(str) {
      return String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#39;");
    }

    function truncate(str, len) {
      const value = String(str ?? "");
      if (value.length <= len) return value;
      return value.slice(0, Math.max(0, len - 1)) + "…";
    }

    function timeAgo(timestamp) {
      const ms = parseTimestamp(timestamp);
      if (!ms) return "unknown";

      const diff = Date.now() - ms;
      if (diff < 0) return "just now";

      const sec = Math.floor(diff / 1000);
      if (sec < 45) return "just now";
      if (sec < 3600) return Math.floor(sec / 60) + "m ago";
      if (sec < 86400) return Math.floor(sec / 3600) + "h ago";
      if (sec < 604800) return Math.floor(sec / 86400) + "d ago";
      if (sec < 2592000) return Math.floor(sec / 604800) + "w ago";
      if (sec < 31536000) return Math.floor(sec / 2592000) + "mo ago";
      return Math.floor(sec / 31536000) + "y ago";
    }

    function formatDate(timestamp) {
      const ms = parseTimestamp(timestamp);
      if (!ms) return "Unknown";
      return new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
      }).format(new Date(ms));
    }

    function shortDate(timestamp) {
      const ms = parseTimestamp(timestamp);
      if (!ms) return "";
      const d = new Date(ms);
      const now = new Date();
      const month = d.toLocaleString("en-US", { month: "short" });
      const day = d.getDate();
      if (d.getFullYear() !== now.getFullYear()) {
        return `${month} ${day}, ${d.getFullYear()}`;
      }
      return `${month} ${day}`;
    }

    function renderMarkdownLite(text) {
      const raw = String(text ?? "");
      const placeholders = [];

      function ph(html) {
        const token = `@@PH_${placeholders.length}@@`;
        placeholders.push(html);
        return token;
      }

      let html = escapeHtml(raw);

      // 1. Fenced code blocks → placeholders
      html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
        const trimmed = String(code).replace(/^\n+|\n+$/g, "");
        return ph(`<pre><code>${trimmed}</code></pre>`);
      });

      // 2. Tables → placeholders (before inline formatting)
      const lines = html.split("\n");
      const afterTables = [];
      let i = 0;

      while (i < lines.length) {
        const line = lines[i];
        if (/^\|(.+)\|$/.test(line.trim())) {
          const tableLines = [];
          let j = i;
          while (j < lines.length && /^\|(.+)\|$/.test(lines[j].trim())) {
            tableLines.push(lines[j].trim());
            j++;
          }
          if (tableLines.length >= 2 && /^\|[\s\-:| ]+\|$/.test(tableLines[1]) && tableLines[1].includes("---")) {
            const sepCells = tableLines[1].split("|").slice(1, -1);
            const aligns = sepCells.map((cell) => {
              const t = cell.trim();
              if (t.startsWith(":") && t.endsWith(":")) return "center";
              if (t.endsWith(":")) return "right";
              return "left";
            });
            const parseRow = (row) => row.split("|").slice(1, -1).map((c) => c.trim());
            const headerCells = parseRow(tableLines[0]);
            let tbl = '<div class="md-table-wrap"><table class="md-table"><thead><tr>';
            headerCells.forEach((cell, ci) => {
              const a = aligns[ci] || "left";
              tbl += `<th${a !== "left" ? ` style="text-align:${a}"` : ""}>${cell}</th>`;
            });
            tbl += "</tr></thead><tbody>";
            for (let b = 2; b < tableLines.length; b++) {
              const cells = parseRow(tableLines[b]);
              tbl += "<tr>";
              cells.forEach((cell, ci) => {
                const a = aligns[ci] || "left";
                tbl += `<td${a !== "left" ? ` style="text-align:${a}"` : ""}>${cell}</td>`;
              });
              tbl += "</tr>";
            }
            tbl += "</tbody></table></div>";
            afterTables.push(ph(tbl));
            i = j;
            continue;
          }
        }
        afterTables.push(line);
        i++;
      }

      html = afterTables.join("\n");

      // 3. Inline formatting
      html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
      html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
      html = html.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>");
      html = html.replace(/\[([^\]\n]+)\]\(([^)\n]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');

      // 4. Block-level elements
      const lines2 = html.split("\n");
      const result = [];
      let li = 0;

      while (li < lines2.length) {
        const ln = lines2[li];

        // Headers
        const hm = ln.match(/^(#{1,6})\s+(.+)$/);
        if (hm) {
          const level = hm[1].length;
          result.push(ph(`<h${level} class="md-h">${hm[2]}</h${level}>`));
          li++;
          continue;
        }

        // Horizontal rule (standalone --- or *** or ___)
        if (/^(\-{3,}|\*{3,}|_{3,})$/.test(ln.trim()) && !ln.trim().startsWith("|")) {
          result.push(ph('<hr class="md-hr">'));
          li++;
          continue;
        }

        // Blockquote (escaped > becomes &gt;)
        if (/^&gt;\s?/.test(ln)) {
          let bqHtml = "";
          while (li < lines2.length && /^&gt;\s?/.test(lines2[li])) {
            const content = lines2[li].replace(/^&gt;\s?/, "");
            bqHtml += (bqHtml ? "<br>" : "") + content;
            li++;
          }
          result.push(ph(`<blockquote class="md-blockquote">${bqHtml}</blockquote>`));
          continue;
        }

        // Unordered list (- or * followed by space)
        if (/^[\-\*]\s+/.test(ln.trim())) {
          let listHtml = '<ul class="md-list">';
          while (li < lines2.length && /^[\-\*]\s+/.test(lines2[li].trim())) {
            const itemText = lines2[li].trim().replace(/^[\-\*]\s+/, "");
            listHtml += `<li>${itemText}</li>`;
            li++;
          }
          listHtml += "</ul>";
          result.push(ph(listHtml));
          continue;
        }

        // Ordered list (1. 2. etc.)
        if (/^\d+\.\s+/.test(ln.trim())) {
          let listHtml = '<ol class="md-list">';
          while (li < lines2.length && /^\d+\.\s+/.test(lines2[li].trim())) {
            const itemText = lines2[li].trim().replace(/^\d+\.\s+/, "");
            listHtml += `<li>${itemText}</li>`;
            li++;
          }
          listHtml += "</ol>";
          result.push(ph(listHtml));
          continue;
        }

        result.push(ln);
        li++;
      }

      html = result.join("\n");

      // 5. Remaining newlines → <br>
      html = html.replace(/\n/g, "<br>");

      // 6. Restore placeholders
      html = html.replace(/@@PH_(\d+)@@/g, (_, idx) => placeholders[Number(idx)] || "");
      return html;
    }

    function parseTimestamp(value) {
      if (value === null || value === undefined || value === "") return null;
      const asNumber = Number(value);
      if (Number.isFinite(asNumber) && asNumber > 0) return asNumber;

      const asDate = Date.parse(String(value));
      return Number.isNaN(asDate) ? null : asDate;
    }

    function pathBasename(path) {
      const clean = String(path ?? "").trim();
      if (!clean) return "Unknown";
      const parts = clean.split(/[\\/]/).filter(Boolean);
      return parts[parts.length - 1] || "Unknown";
    }

    function pathTail(path) {
      const clean = String(path ?? "").trim();
      if (!clean) return "Unknown";
      const parts = clean.split(/[\\/]/).filter(Boolean);
      if (parts.length <= 2) return parts.join("/") || "Unknown";
      return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    }

    function toDisplayString(value) {
      if (value === null || value === undefined) return "";
      if (typeof value === "string") return value;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    }

    function normalizeToolStatus(status) {
      const raw = String(status ?? "").trim().toLowerCase();
      if (!raw) return "pending";
      if (raw === "completed" || raw === "complete" || raw === "success" || raw === "succeeded" || raw === "done") {
        return "completed";
      }
      if (raw === "error" || raw === "failed" || raw === "failure") {
        return "error";
      }
      return "pending";
    }

    function hasContent(value) {
      if (value === null || value === undefined) return false;
      if (typeof value === "string") return value.trim().length > 0;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === "object") return Object.keys(value).length > 0;
      return true;
    }

    function formatDuration(start, end) {
      const startMs = parseTimestamp(start);
      const endMs = parseTimestamp(end);
      if (startMs === null || endMs === null) return null;
      const durationMs = endMs - startMs;
      if (!Number.isFinite(durationMs) || durationMs < 0) return null;
      if (durationMs < 1000) return `${Math.round(durationMs)}ms`;

      const seconds = durationMs / 1000;
      const fixed = seconds >= 10 ? seconds.toFixed(1) : seconds.toFixed(2);
      return `${fixed.replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1")}s`;
    }

    function formatTokenValue(value) {
      const num = Number(value);
      return Number.isFinite(num) ? num.toLocaleString() : "?";
    }

    function safeColor(color) {
      if (typeof color !== "string") return "#bbb";
      const value = color.trim();
      if (/^#([a-fA-F0-9]{3}|[a-fA-F0-9]{6})$/.test(value)) return value;
      if (/^(rgb|hsl)a?\(/i.test(value)) return value;
      return "#bbb";
    }

    function firstArray(candidates) {
      for (const candidate of candidates) {
        if (Array.isArray(candidate)) return candidate;
      }
      return [];
    }

    function extractProjects(payload) {
      return firstArray([
        payload,
        payload?.projects,
        payload?.items,
        payload?.results,
        payload?.data,
        payload?.data?.projects,
        payload?.data?.items,
        payload?.data?.results
      ]);
    }

    function extractSessions(payload) {
      return firstArray([
        payload,
        payload?.sessions,
        payload?.items,
        payload?.results,
        payload?.data,
        payload?.data?.sessions,
        payload?.data?.items,
        payload?.data?.results
      ]);
    }

    function extractMessages(payload) {
      return firstArray([
        payload?.messages,
        payload?.session?.messages,
        payload?.data?.messages,
        payload?.data?.session?.messages,
        payload
      ]);
    }

    function normalizeProject(item, index) {
      const worktree = item?.worktree_path ?? item?.worktreePath ?? item?.worktree ?? item?.path ?? "";
      const id = String(item?.id ?? item?.project_id ?? item?.projectId ?? item?.uuid ?? worktree ?? `project-${index}`);
      return {
        raw: item,
        id,
        name: item?.name ?? item?.project_name ?? item?.projectName ?? item?.title ?? pathBasename(worktree),
        worktree,
        iconColor: item?.icon_color ?? item?.iconColor ?? null,
        updatedAt: parseTimestamp(item?.time_updated ?? item?.updated_at ?? item?.updatedAt ?? item?.last_updated ?? item?.lastUpdate)
      };
    }

    function normalizeSession(item, index) {
      const id = String(item?.id ?? item?.session_id ?? item?.sessionId ?? item?.uuid ?? `session-${index}`);
      const summaryValue = item?.summary ?? item?.summary_text ?? item?.summaryText ?? item?.has_summary ?? item?.hasSummary;
      const projectId = item?.project_id ?? item?.projectId ?? null;
      const project = state.projects.find((p) => p.id === String(projectId));
      const projectWorktree = item?.project_worktree ?? item?.projectWorktree ?? project?.worktree ?? null;
      return {
        raw: item,
        id,
        projectId: projectId === null || projectId === undefined ? null : String(projectId),
        projectName: item?.project_name ?? item?.projectName ?? project?.name ?? null,
        projectWorktree,
        title: item?.title ?? item?.name ?? item?.session_title ?? item?.sessionTitle ?? "Untitled",
        updatedAt: parseTimestamp(item?.time_updated ?? item?.updated_at ?? item?.updatedAt ?? item?.time_created ?? item?.created_at),
        hasSummary: Boolean(summaryValue)
      };
    }

    function extractTokenCount(item) {
      const direct = item?.token_count ?? item?.tokenCount ?? item?.total_tokens ?? item?.totalTokens;
      if (typeof direct === "number" && Number.isFinite(direct)) return direct;

      const tokensObj = item?.tokens;
      if (tokensObj && typeof tokensObj === "object") {
        const total = tokensObj.total ?? tokensObj.total_tokens ?? tokensObj.totalTokens;
        if (typeof total === "number" && Number.isFinite(total)) return total;

        const input = Number(tokensObj.input ?? tokensObj.input_tokens ?? tokensObj.prompt_tokens ?? NaN);
        const output = Number(tokensObj.output ?? tokensObj.output_tokens ?? tokensObj.completion_tokens ?? NaN);
        if (Number.isFinite(input) || Number.isFinite(output)) {
          return (Number.isFinite(input) ? input : 0) + (Number.isFinite(output) ? output : 0);
        }
      }

      const inputTokens = Number(item?.input_tokens ?? item?.prompt_tokens ?? NaN);
      const outputTokens = Number(item?.output_tokens ?? item?.completion_tokens ?? NaN);
      if (Number.isFinite(inputTokens) || Number.isFinite(outputTokens)) {
        return (Number.isFinite(inputTokens) ? inputTokens : 0) + (Number.isFinite(outputTokens) ? outputTokens : 0);
      }

      return null;
    }

    function normalizeMessageParts(item) {
      const parts = item?.parts ?? item?.content ?? item?.blocks ?? item?.message;
      if (Array.isArray(parts)) {
        return parts.map((part) => {
          if (typeof part === "string") return { type: "text", text: part };
          if (part && typeof part === "object") return part;
          return { type: "text", text: String(part ?? "") };
        });
      }

      if (typeof parts === "string") return [{ type: "text", text: parts }];
      if (item?.text) return [{ type: "text", text: item.text }];
      if (item?.content && typeof item.content === "object") return [{ type: "text", text: toDisplayString(item.content) }];
      return [];
    }

    function normalizeMessage(item, index) {
      if (item?._type === "subagent") {
        const id = String(item?.id ?? item?.session_id ?? item?.sessionId ?? `subagent-${index}`);
        const timeCreated = parseTimestamp(item?.time_created ?? item?.created_at ?? item?.createdAt);
        const timeUpdated = parseTimestamp(item?.time_updated ?? item?.updated_at ?? item?.updatedAt);
        return {
          raw: item,
          _type: "subagent",
          id,
          title: item?.title ?? item?.name ?? "Subagent",
          summary: item?.summary ?? null,
          time_created: timeCreated,
          time_updated: timeUpdated,
          timestamp: timeCreated ?? timeUpdated,
          role: null,
          model: null,
          cost: null,
          tokens: null,
          parts: []
        };
      }

      const role = String(item?.role ?? item?.author ?? "unknown").toLowerCase();
      return {
        raw: item,
        _type: "message",
        id: String(item?.id ?? item?.message_id ?? item?.messageId ?? `message-${index}`),
        role,
        model: item?.model ?? item?.modelID ?? item?.model_name ?? item?.modelName ?? item?.metadata?.model ?? null,
        timestamp: parseTimestamp(item?.time_created ?? item?.created_at ?? item?.createdAt ?? item?.time_updated ?? item?.updated_at),
        cost: item?.cost_usd ?? item?.cost ?? item?.metadata?.cost_usd ?? item?.metadata?.cost ?? null,
        tokens: extractTokenCount(item),
        parts: normalizeMessageParts(item)
      };
    }

    function formatCost(value) {
      const num = Number(value);
      if (!Number.isFinite(num)) return null;
      return `$${num.toFixed(num < 0.01 ? 5 : 4)}`;
    }

    async function fetchJson(url) {
      const response = await fetch(url);
      const text = await response.text();

      let payload = null;
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = text;
        }
      }

      if (!response.ok) {
        const reason =
          (payload && typeof payload === "object" && (payload.error || payload.message)) ||
          (typeof payload === "string" && payload) ||
          response.statusText ||
          `HTTP ${response.status}`;
        throw new Error(String(reason));
      }

      return payload;
    }

    function getSelectedProject() {
      return state.projects.find((p) => p.id === state.selectedProjectId) || null;
    }

    function getSelectedSession() {
      return state.sessions.find((s) => s.id === state.selectedSessionId) || null;
    }

    function hasBulkActions() {
      return (window.OCV?.listBulkActions?.() ?? []).length > 0;
    }

    function renderProjectsPanel() {
      const plugins = window.OCV?.list?.() ?? [];
      const header = `
        <div class="panel-header">
          <div>
            <h2 class="panel-title">Projects</h2>
            <div class="panel-subtitle">${state.projects.length} total</div>
          </div>
          <div class="header-actions">
            ${hasBulkActions() ? `<button class="header-btn ${state.selectMode ? "active" : ""}" data-action="toggle-select-mode">${state.selectMode ? "Done" : "Select"}</button>` : ""}
            <button class="header-btn ${state.pluginsOpen ? "active" : ""}" data-action="toggle-plugins">Plugins${plugins.length ? ` (${plugins.length})` : ""}</button>
          </div>
        </div>
      `;

      let body = "";
      if (state.projectsLoading) {
        body = `<div class="state">Loading...</div>`;
      } else if (state.projectsError) {
        body = `<div class="state error">${escapeHtml(state.projectsError)}</div>`;
      } else if (!state.projects.length) {
        body = `<div class="state">No projects found.</div>`;
      } else {
        body = state.projects
          .map((project) => {
            const selected = project.id === state.selectedProjectId ? "selected" : "";
            const titleDate = project.updatedAt ? formatDate(project.updatedAt) : "Unknown";
            const relativeTime = timeAgo(project.updatedAt);
            const compactDate = shortDate(project.updatedAt);
            const displayTime = compactDate ? `${compactDate} · ${relativeTime}` : relativeTime;
            const inner = `
                <div class="project-top">
                  <span class="dot" style="background:${safeColor(project.iconColor)}"></span>
                  <span class="project-name" title="${escapeHtml(project.name)}">${escapeHtml(project.name)}</span>
                  <span class="project-time" title="${escapeHtml(titleDate)}">${escapeHtml(displayTime)}</span>
                </div>
                <div class="project-path" title="${escapeHtml(project.worktree || "")}">${escapeHtml(truncate(project.worktree || "(no worktree path)", 44))}</div>
            `;

            if (state.selectMode) {
              const checked = state.selectedProjectIds.has(project.id);
              return `
                <div class="project-row selectable ${checked ? "checked" : ""}" data-action="toggle-project-select" data-project-id="${escapeHtml(project.id)}" role="checkbox" aria-checked="${checked}" tabindex="0">
                  <span class="checkbox ${checked ? "checked" : ""}"></span>
                  <div class="project-row-body">${inner}</div>
                </div>
              `;
            }

            return `
              <button class="project-row ${selected}" data-action="select-project" data-project-id="${escapeHtml(project.id)}">
                ${inner}
              </button>
            `;
          })
          .join("");
      }

      el.projects.innerHTML = `${header}${buildSessionsToolbarHtml()}<div class="panel-body">${body}</div>`;
      renderBulkBar();
    }

    function buildSessionsHeaderHtml(projectName, subtitleText) {
      return `
        <div class="panel-header">
          <div style="flex:1;min-width:0;">
            <h2 class="panel-title">${escapeHtml(projectName)}</h2>
            <div class="panel-subtitle">${escapeHtml(subtitleText)}</div>
          </div>
          ${hasBulkActions() && state.sessions.length ? `<div class="header-actions"><button class="header-btn ${state.selectMode ? "active" : ""}" data-action="toggle-select-mode">${state.selectMode ? "Done" : "Select"}</button></div>` : ""}
        </div>
      `;
    }

    function buildSessionsToolbarHtml() {
      const scope = state.sessionsScope;
      return `
        <div class="sessions-toolbar">
          <input
            type="search"
            class="sessions-search"
            data-action="search-sessions"
            aria-label="Search sessions across projects by keyword"
            placeholder="Search all sessions..."
            value="${escapeHtml(state.sessionsQuery)}"
            autocomplete="off"
            spellcheck="false" />
          <select class="sessions-scope" data-action="scope-sessions" aria-label="Search scope">
            <option value="all"${scope === "all" ? " selected" : ""}>All messages</option>
            <option value="user"${scope === "user" ? " selected" : ""}>User input</option>
            <option value="assistant"${scope === "assistant" ? " selected" : ""}>Model response</option>
          </select>
        </div>
      `;
    }

    function buildSessionsBodyHtml() {
      const isSearching = Boolean(state.sessionsQuery);

      if (!state.selectedProjectId && !isSearching) {
        return `<div class="state">Select a project or search all projects.</div>`;
      }

      if (state.sessionsLoading && state.sessions.length === 0) {
        return `<div class="state">Loading...</div>`;
      }

      if (state.sessionsError) {
        return `<div class="state error">${escapeHtml(state.sessionsError)}</div>`;
      }

      if (!state.sessions.length) {
        if (state.sessionsQuery) {
          const scopeLabel =
            state.sessionsScope === "user"
              ? " in user messages"
              : state.sessionsScope === "assistant"
                ? " in model responses"
                : "";
          return `<div class="state">No sessions match "${escapeHtml(state.sessionsQuery)}"${scopeLabel}.</div>`;
        }
        return `<div class="state">No sessions found.</div>`;
      }

      let body = state.sessions
        .map((session) => {
          const selected = session.id === state.selectedSessionId ? "selected" : "";
          const time = session.updatedAt ? timeAgo(session.updatedAt) : "unknown";
          const date = shortDate(session.updatedAt);
          const displayTime = date ? `${date} · ${time}` : time;
          const exact = session.updatedAt ? formatDate(session.updatedAt) : "Unknown";
          const projectName = session.projectName || (session.projectWorktree ? pathBasename(session.projectWorktree) : "Unknown project");
          const projectPath = session.projectWorktree || "";
          const projectContext = projectPath
            ? `${projectName} · ${truncate(projectPath, 48)}`
            : projectName;
          const inner = `
              <p class="session-title" title="${escapeHtml(session.title || "Untitled")}">${escapeHtml(session.title || "Untitled")}</p>
              ${isSearching ? `<div class="session-project-context" title="${escapeHtml(projectPath || projectName)}">${escapeHtml(projectContext)}</div>` : ""}
              <div class="session-meta">
                <span title="${escapeHtml(exact)}">${escapeHtml(displayTime)}</span>
                ${session.hasSummary ? '<span class="badge">summarized</span>' : ""}
              </div>
          `;

          if (state.selectMode) {
            const checked = state.selectedSessionIds.has(session.id);
            return `
              <div class="session-card selectable ${checked ? "checked" : ""}" data-action="toggle-session-select" data-session-id="${escapeHtml(session.id)}" role="checkbox" aria-checked="${checked}" tabindex="0">
                <span class="checkbox ${checked ? "checked" : ""}"></span>
                <div class="session-card-body">${inner}</div>
              </div>
            `;
          }

          return `
            <button class="session-card ${selected}" data-action="select-session" data-session-id="${escapeHtml(session.id)}">
              ${inner}
            </button>
          `;
        })
        .join("");

      if (state.sessionsHasMore) {
        body += `
          <div class="load-more-wrap">
            <button class="load-more-btn" data-action="load-more-sessions" ${state.sessionsLoadingMore ? "disabled" : ""}>
              ${state.sessionsLoadingMore ? "Loading..." : "Load more"}
            </button>
          </div>
        `;
      }

      return body;
    }

    function renderSessionsPanel() {
      const selectedProject = getSelectedProject();
      const isSearching = Boolean(state.sessionsQuery);
      const projectName = isSearching ? "Search results" : selectedProject ? selectedProject.name : "Sessions";
      const totalLabel = state.sessionsTotal !== null ? ` / ${state.sessionsTotal}` : "";
      const subtitleText = isSearching
        ? `${state.sessions.length}${totalLabel} matching sessions across projects`
        : `${state.sessions.length}${totalLabel} sessions`;
      const existingToolbar = el.sessions.querySelector(".sessions-toolbar");
      const existingBody = el.sessions.querySelector(".panel-body");
      const existingSubtitle = el.sessions.querySelector(".panel-subtitle");
      const existingTitle = el.sessions.querySelector(".panel-title");
      const wantToolbar = false;
      const hasToolbar = Boolean(existingToolbar);
      const renderedProjectId = el.sessions.dataset.projectId || "";
      const currentProjectId = state.selectedProjectId || "";
      const headerSignature = `${state.selectMode}|${state.sessions.length}|${hasBulkActions()}`;
      const renderedHeaderSignature = el.sessions.dataset.headerSignature || "";

      if (
        renderedProjectId === currentProjectId &&
        hasToolbar === wantToolbar &&
        renderedHeaderSignature === headerSignature &&
        existingBody &&
        existingSubtitle &&
        existingTitle
      ) {
        existingTitle.textContent = projectName;
        existingSubtitle.textContent = subtitleText;
        existingBody.innerHTML = buildSessionsBodyHtml();
        renderBulkBar();
        return;
      }

      el.sessions.innerHTML = `${buildSessionsHeaderHtml(projectName, subtitleText)}<div class="panel-body">${buildSessionsBodyHtml()}</div>`;
      el.sessions.dataset.projectId = currentProjectId;
      el.sessions.dataset.headerSignature = headerSignature;
      renderBulkBar();
    }

    function renderBulkBar() {
      if (!el.bulkBar) return;
      const count = state.selectedProjectIds.size + state.selectedSessionIds.size;
      if (!state.selectMode || count === 0) {
        el.bulkBar.hidden = true;
        el.bulkBar.innerHTML = "";
        return;
      }

      const buttons = (window.OCV?.listBulkActions?.() ?? [])
        .map(
          (action) =>
            `<button class="bulk-btn ${action.danger ? "danger" : ""}" data-action="bulk-run" data-bulk-id="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`
        )
        .join("");

      el.bulkBar.hidden = false;
      el.bulkBar.innerHTML = `
        <span class="bulk-count">${count} selected</span>
        ${buttons}
        <button class="bulk-btn ghost" data-action="bulk-clear">Clear</button>
      `;
    }

    function renderPluginsDialog() {
      if (!el.modal) return;
      if (!state.pluginsOpen) {
        el.modal.innerHTML = "";
        return;
      }

      const plugins = window.OCV?.list?.() ?? [];
      const rows = plugins.length
        ? plugins
            .map(
              (plugin) => `
                <label class="plugin-row">
                  <input type="checkbox" data-action="toggle-plugin" data-plugin-id="${escapeHtml(plugin.id)}" ${plugin.enabled ? "checked" : ""} />
                  <span class="plugin-info">
                    <span class="plugin-name">${escapeHtml(plugin.name)}</span>
                    ${plugin.description ? `<span class="plugin-desc">${escapeHtml(plugin.description)}</span>` : ""}
                  </span>
                </label>
              `
            )
            .join("")
        : `<div class="state">No plugins found in public/plugins/.</div>`;

      el.modal.innerHTML = `
        <div class="modal-overlay">
          <div class="modal" role="dialog" aria-label="Plugins">
            <div class="modal-header">
              <h3>Plugins</h3>
              <button class="header-btn" data-action="close-plugins">Close</button>
            </div>
            <div class="modal-body">${rows}</div>
          </div>
        </div>
      `;
    }

    function renderToolResultPart(output) {
      const full = toDisplayString(output);
      if (full.length <= 2000) {
        return `<pre>${escapeHtml(full || "(empty)")}</pre>`;
      }

      const shortId = `tool-short-${++toolResultCounter}`;
      const fullId = `tool-full-${toolResultCounter}`;
      const shortText = `${full.slice(0, 2000)}\n… (truncated)`;

      return `
        <pre id="${shortId}">${escapeHtml(shortText)}</pre>
        <pre id="${fullId}" hidden>${escapeHtml(full)}</pre>
        <button class="mini-btn" data-action="toggle-result" data-short-id="${shortId}" data-full-id="${fullId}" data-expanded="false">Show more</button>
      `;
    }

    function renderMessagePart(part) {
      const type = String(part?.type ?? "text").toLowerCase();

      const pluginRenderer = window.OCV?.getPartRenderer?.(type);
      if (pluginRenderer) {
        try {
          const html = pluginRenderer(part, { escapeHtml, toDisplayString, renderMarkdownLite });
          if (html) return html;
        } catch (error) {
          console.error("OCV plugin part renderer failed:", error);
        }
      }

      if (type === "step-start" || type === "snapshot") {
        return "";
      }

      if (type === "text") {
        const text = part?.text ?? "";
        return `<div class="part">${renderMarkdownLite(toDisplayString(text))}</div>`;
      }

      if (type === "reasoning") {
        const text = part?.text ?? "";
        return `
          <div class="part">
            <details>
              <summary class="summary-reasoning">Reasoning</summary>
              <pre>${escapeHtml(toDisplayString(text) || "(empty)")}</pre>
            </details>
          </div>
        `;
      }

      if (type === "tool") {
        const partId = part?.id;
        const toolName = part?.tool ?? "Unknown";
        const statusClass = normalizeToolStatus(part?.state?.status);
        const title = part?.state?.title;
        const input = part?.state?.input ?? {};
        const output = part?.state?.output;
        const duration = formatDuration(part?.state?.time?.start, part?.state?.time?.end);
        let attachmentHtml = "";

        if (part?.hasAttachments && partId) {
          attachmentHtml = `
            <div style="margin-top:8px;">
              <div class="tiny-muted">Attachment</div>
              <img src="/api/parts/${encodeURIComponent(partId)}/image" loading="lazy" class="part-image" alt="Tool attachment" />
            </div>
          `;
        }

        return `
          <div class="part">
            <details>
              <summary class="summary-tool">🔧 ${escapeHtml(String(toolName))}<span class="tool-status ${statusClass}">${escapeHtml(statusClass)}</span></summary>
              ${title ? `<div class="tiny-muted" style="margin-top:6px;">${escapeHtml(String(title))}</div>` : ""}
              <div class="tiny-muted" style="margin-top:6px;">Input</div>
              <pre>${escapeHtml(toDisplayString(input) || "{}")}</pre>
              ${hasContent(output) ? `<div class="tiny-muted" style="margin-top:8px;">Output</div>${renderToolResultPart(output)}` : ""}
              ${duration ? `<div class="tiny-muted" style="margin-top:8px;">Execution time: ${escapeHtml(duration)}</div>` : ""}
              ${attachmentHtml}
            </details>
          </div>
        `;
      }

      if (type === "patch") {
        const hash = String(part?.hash ?? "");
        const shortHash = hash ? hash.slice(0, 7) : "unknown";
        const files = Array.isArray(part?.files) ? part.files : [];
        const fileList = files.map((file) => escapeHtml(pathTail(file))).join("<br>");

        return `
          <div class="part part-patch">
            <div>📝 <strong>Patch</strong> <code>${escapeHtml(shortHash)}</code></div>
            ${fileList ? `<div class="part-patch-files">${fileList}</div>` : ""}
          </div>
        `;
      }

      if (type === "file") {
        const filename = part?.filename ?? "Attachment";
        const mime = part?.mime ?? "unknown";
        const hasImage = Boolean(part?.hasImage);
        const isText = typeof mime === "string" && mime.toLowerCase().startsWith("text/");
        const partId = part?.id;

        let imageHtml = "";
        if (hasImage && partId) {
          imageHtml = `<img src="/api/parts/${encodeURIComponent(partId)}/image" loading="lazy" class="part-image" alt="${escapeHtml(String(filename))}" />`;
        }

        return `
          <div class="part part-file-wrap">
            <div class="part-file">
              <span>📎</span>
              <div>
                <div>${escapeHtml(String(filename))}</div>
                <div class="tiny-muted">${escapeHtml(String(mime))}${isText ? " · text file" : ""}</div>
              </div>
            </div>
            ${imageHtml}
          </div>
        `;
      }

      if (type === "agent") {
        const nameRaw = String(part?.name ?? part?.source?.value ?? "agent");
        const name = nameRaw.replace(/^@+/, "") || "agent";
        return `<div class="part"><span class="part-agent">🤖 @${escapeHtml(name)}</span></div>`;
      }

      if (type === "step-finish") {
        const cost = formatCost(part?.cost);
        const inputTokens = formatTokenValue(part?.tokens?.input);
        const outputTokens = formatTokenValue(part?.tokens?.output);
        return `
          <div class="part part-step-finish">
            <span>Step complete</span>
            ${cost ? `<span>· ${escapeHtml(cost)}</span>` : ""}
            <span>· ${escapeHtml(`${inputTokens}→${outputTokens} tokens`)}</span>
          </div>
        `;
      }

      if (type === "compaction") {
        return `<div class="part part-compaction">── context compacted ──</div>`;
      }

      if (type === "retry") {
        return `<div class="part part-retry">⟳ Retried</div>`;
      }

      const text = part?.text ?? part?.content ?? part?.value;
      if (typeof text === "string" && text.trim()) {
        return `<div class="part">${renderMarkdownLite(toDisplayString(text))}</div>`;
      }

      return `<div class="part"><pre>${escapeHtml(toDisplayString(part) || "(empty)")}</pre></div>`;
    }

    function renderSubagentCard(entry) {
      const title = entry.title || entry.id || "Subagent";
      const time = entry.time_created ? formatDate(entry.time_created) : "";
      const ago = entry.time_created ? timeAgo(entry.time_created) : "";
      const timeLabel = [time, ago].filter(Boolean).join(" · ");

      return `
        <div class="subagent-card" data-action="navigate-subagent" data-session-id="${escapeHtml(entry.id)}">
          <div class="subagent-card-icon">🤖</div>
          <div class="subagent-card-content">
            <div class="subagent-card-title">${escapeHtml(title)}</div>
            <div class="subagent-card-time">${escapeHtml(timeLabel || "Unknown")}</div>
          </div>
          <div class="subagent-card-arrow">→</div>
        </div>
      `;
    }

    function messageDomId(messageId) {
      return `message-${String(messageId ?? "").replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    }

    function getMessagePreview(message) {
      for (const part of message?.parts ?? []) {
        const type = String(part?.type ?? "text").toLowerCase();
        if (type !== "text" && type !== "reasoning") continue;
        const text = toDisplayString(part?.text ?? part?.content ?? part?.value).replace(/\s+/g, " ").trim();
        if (text) return truncate(text, 86);
      }

      for (const part of message?.parts ?? []) {
        const text = toDisplayString(part?.text ?? part?.content ?? part?.value).replace(/\s+/g, " ").trim();
        if (text) return truncate(text, 86);
      }

      return "(empty user input)";
    }

    function getUserInputMessages() {
      return state.messages.filter((message) => message?._type !== "subagent" && message.role === "user");
    }

    function renderMessageOutline() {
      const collapsed = state.messageOutlineCollapsed;
      const userMessages = getUserInputMessages();
      const title = `${userMessages.length} user input${userMessages.length === 1 ? "" : "s"}`;
      const items = userMessages.length
        ? userMessages.map((message, index) => {
          const label = getMessagePreview(message);
          const time = message.timestamp ? shortDate(message.timestamp) || timeAgo(message.timestamp) : "";
          return `
            <button class="message-outline-item" data-action="scroll-message" data-message-id="${escapeHtml(message.id)}" title="${escapeHtml(label)}">
              <div class="message-outline-item-title">${escapeHtml(label)}</div>
              <div class="message-outline-item-time">${escapeHtml(time || `Input ${index + 1}`)}</div>
            </button>
          `;
        }).join("")
        : `<div class="message-outline-empty">No user inputs in this session.</div>`;

      return `
        <aside class="message-outline ${collapsed ? "collapsed" : ""}" aria-label="User input navigation">
          <div class="message-outline-header">
            <div class="message-outline-title" title="${escapeHtml(title)}">${escapeHtml(title)}</div>
            <button class="message-outline-toggle" data-action="toggle-message-outline" aria-label="${collapsed ? "Expand user input navigation" : "Collapse user input navigation"}">${collapsed ? "‹" : "›"}</button>
          </div>
          <div class="message-outline-list">${items}</div>
        </aside>
      `;
    }

    function renderMessage(message) {
      if (message?._type === "subagent") {
        return renderSubagentCard(message);
      }

      const roleClass =
        message.role === "user"
          ? "role-user"
          : message.role === "assistant"
            ? "role-assistant"
            : "role-other";

      const roleLabel = message.role ? message.role.charAt(0).toUpperCase() + message.role.slice(1) : "Unknown";
      const timeLabel = message.timestamp ? formatDate(message.timestamp) : "Unknown time";
      const meta = [
        `<span class="pill">${escapeHtml(roleLabel)}</span>`,
        `<span>${escapeHtml(timeLabel)}</span>`
      ];

      if (message.role === "assistant" && message.model) {
        meta.splice(1, 0, `<span class="pill">${escapeHtml(message.model)}</span>`);
      }

      const cost = formatCost(message.cost);
      if (message.role === "assistant" && cost) {
        meta.push(`<span class="pill">cost ${escapeHtml(cost)}</span>`);
      }

      if (message.role === "assistant" && typeof message.tokens === "number") {
        meta.push(`<span class="pill">${message.tokens.toLocaleString()} tokens</span>`);
      }

      const renderedParts = message.parts.map((part) => renderMessagePart(part)).filter(Boolean);
      const parts = renderedParts.length
        ? renderedParts.join("")
        : `<div class="part tiny-muted">(no message content)</div>`;

      return `
        <article class="message ${roleClass}" id="${escapeHtml(messageDomId(message.id))}" data-message-id="${escapeHtml(message.id)}">
          <div class="message-meta">${meta.join("")}</div>
          ${parts}
        </article>
      `;
    }

    function buildHeaderActions() {
      if (!state.selectedSessionId || state.sessionLoading || state.sessionError) return "";

      const formats = [
        { id: "md", label: "Markdown (.md)" },
        { id: "json", label: "JSON (.json)" }
      ];
      for (const format of window.OCV?.listExportFormats?.() ?? []) {
        formats.push({ id: format.id, label: format.label || format.id, plugin: true });
      }

      const formatButtons = formats
        .map((format) => {
          const pluginFlag = format.plugin ? ' data-plugin="true"' : "";
          return `<button class="export-menu-item" data-action="export-session" data-format="${escapeHtml(format.id)}"${pluginFlag}>${escapeHtml(format.label)}</button>`;
        })
        .join("");

      const exportMenu = `
        <div class="export-menu-wrap">
          <button class="header-btn" data-action="toggle-export-menu" aria-haspopup="true" aria-expanded="${state.exportMenuOpen}">Export ▾</button>
          ${state.exportMenuOpen ? `<div class="export-menu">${formatButtons}</div>` : ""}
        </div>
      `;

      const pluginActions = (window.OCV?.listSessionActions?.() ?? [])
        .map(
          (action) =>
            `<button class="header-btn" data-action="plugin-session-action" data-action-id="${escapeHtml(action.id)}">${escapeHtml(action.label)}</button>`
        )
        .join("");

      return `<div class="header-actions">${pluginActions}${exportMenu}</div>`;
    }

    function renderMessagesPanel() {
      const fallbackTitle = getSelectedSession()?.title || "Session";
      const title = state.sessionData?.title ?? fallbackTitle;
      const sessionUpdatedAt = state.sessionData?.updatedAt ?? getSelectedSession()?.updatedAt ?? null;
      const subtitle = state.selectedSessionId
        ? `${state.messages.length} messages${sessionUpdatedAt ? ` · updated ${timeAgo(sessionUpdatedAt)}` : ""}`
        : "";

      const backBtn = state.sessionStack.length > 0
        ? '<button class="back-btn" data-action="navigate-back">← Back</button>'
        : "";

      const header = `
        <div class="panel-header">
          <div style="flex:1;min-width:0;">
            <h2 class="panel-title">${escapeHtml(title || "Session")}</h2>
            <div class="panel-subtitle">${escapeHtml(subtitle)}</div>
          </div>
          ${buildHeaderActions()}
          ${backBtn}
        </div>
      `;

      let body = "";
      if (!state.selectedSessionId) {
        body = `<div class="state">Select a session.</div>`;
      } else if (state.sessionLoading) {
        body = `<div class="state">Loading...</div>`;
      } else if (state.sessionError) {
        body = `<div class="state error">${escapeHtml(state.sessionError)}</div>`;
      } else {
        const messagesHtml = state.messages.length
          ? state.messages
            .map((message) => (message?._type === "subagent" ? renderSubagentCard(message) : renderMessage(message)))
            .join("")
          : `<div class="state">No messages for this session.</div>`;
        body = `<div class="messages">${messagesHtml}</div>`;
      }

      const outline = state.selectedSessionId && !state.sessionLoading && !state.sessionError ? renderMessageOutline() : "";
      el.messages.innerHTML = `${header}<div class="messages-shell"><div class="panel-body">${body}</div>${outline}</div>`;
    }

    function extractTotal(payload) {
      const raw = payload?.total ?? payload?.count ?? payload?.pagination?.total ?? payload?.meta?.total;
      const num = Number(raw);
      return Number.isFinite(num) ? num : null;
    }

    function extractHasMore(payload, loadedCount, pageSize, receivedCount, totalCount) {
      const explicit =
        payload?.has_more ??
        payload?.hasMore ??
        payload?.pagination?.has_more ??
        payload?.pagination?.hasMore ??
        payload?.meta?.has_more ??
        payload?.meta?.hasMore;

      if (typeof explicit === "boolean") return explicit;
      if (totalCount !== null) return loadedCount < totalCount;
      return receivedCount === pageSize;
    }

    async function loadProjects() {
      const requestId = ++projectsRequestId;
      state.projectsLoading = true;
      state.projectsError = null;
      renderProjectsPanel();

      try {
        const payload = await fetchJson("/api/projects");
        if (requestId !== projectsRequestId) return;

        const projects = extractProjects(payload).map((item, index) => normalizeProject(item, index));
        state.projects = projects;
      } catch (error) {
        if (requestId !== projectsRequestId) return;
        state.projectsError = error instanceof Error ? error.message : String(error);
      } finally {
        if (requestId !== projectsRequestId) return;
        state.projectsLoading = false;
        renderProjectsPanel();
      }
    }

    async function loadSessions({ reset = false } = {}) {
      const requestQuery = state.sessionsQuery;
      const requestScope = state.sessionsScope;
      const isGlobalSearch = Boolean(requestQuery);
      if (!state.selectedProjectId && !isGlobalSearch) {
        sessionsRequestId++;
        if (reset) {
          state.sessions = [];
          state.sessionsLoading = false;
          state.sessionsLoadingMore = false;
          state.sessionsError = null;
          state.sessionsPage = 1;
          state.sessionsHasMore = false;
          state.sessionsTotal = null;
          renderSessionsPanel();
        }
        return;
      }

      if (reset) {
        state.sessionsLoading = true;
        state.sessionsError = null;
        state.sessionsPage = 1;
        state.sessionsHasMore = false;
        state.sessionsTotal = null;
      } else {
        if (state.sessionsLoadingMore || !state.sessionsHasMore) return;
        state.sessionsLoadingMore = true;
      }

      renderSessionsPanel();

      const projectId = state.selectedProjectId;
      const nextPage = reset ? 1 : state.sessionsPage + 1;
      const requestId = ++sessionsRequestId;

      try {
        const params = new URLSearchParams({
          page: String(nextPage),
          limit: String(state.sessionsLimit)
        });
        if (requestQuery) params.set("q", requestQuery);
        if (requestScope && requestScope !== "all") {
          params.set("scope", requestScope);
        }
        const url = isGlobalSearch
          ? `/api/sessions/search?${params.toString()}`
          : `/api/projects/${encodeURIComponent(projectId)}/sessions?${params.toString()}`;
        const payload = await fetchJson(url);
        if (
          requestId !== sessionsRequestId ||
          projectId !== state.selectedProjectId ||
          requestQuery !== state.sessionsQuery ||
          requestScope !== state.sessionsScope
        ) return;

        const incoming = extractSessions(payload).map((item, index) => normalizeSession(item, index));

        if (reset) {
          state.sessions = incoming;
        } else {
          const byId = new Map(state.sessions.map((session) => [session.id, session]));
          for (const item of incoming) byId.set(item.id, item);
          state.sessions = Array.from(byId.values());
        }

        state.sessionsTotal = extractTotal(payload);
        state.sessionsHasMore = extractHasMore(
          payload,
          state.sessions.length,
          state.sessionsLimit,
          incoming.length,
          state.sessionsTotal
        );
        state.sessionsPage = nextPage;
      } catch (error) {
        if (
          requestId !== sessionsRequestId ||
          projectId !== state.selectedProjectId ||
          requestQuery !== state.sessionsQuery ||
          requestScope !== state.sessionsScope
        ) return;
        state.sessionsError = error instanceof Error ? error.message : String(error);
      } finally {
        if (
          requestId !== sessionsRequestId ||
          projectId !== state.selectedProjectId ||
          requestQuery !== state.sessionsQuery ||
          requestScope !== state.sessionsScope
        ) return;
        state.sessionsLoading = false;
        state.sessionsLoadingMore = false;
        renderSessionsPanel();
      }
    }

    async function loadSession(sessionId) {
      state.selectedSessionId = sessionId;
      state.sessionLoading = true;
      state.sessionError = null;
      state.sessionData = null;
      state.messages = [];
      renderSessionsPanel();
      renderMessagesPanel();

      const requestId = ++sessionRequestId;

      try {
        const sessionPayload = await fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}`);
        if (requestId !== sessionRequestId || state.selectedSessionId !== sessionId) return;

        const sessionObject = sessionPayload?.session ?? sessionPayload?.data?.session ?? sessionPayload;
        const selectedSession = getSelectedSession();
        state.sessionData = {
          id: String(sessionObject?.id ?? sessionObject?.session_id ?? sessionId),
          title: sessionObject?.title ?? sessionObject?.name ?? selectedSession?.title ?? "Untitled",
          parentId: sessionObject?.parent_id ?? sessionObject?.parentId ?? null,
          updatedAt: parseTimestamp(
            sessionObject?.time_updated ?? sessionObject?.updated_at ?? sessionObject?.time_created ?? sessionObject?.created_at
          )
        };

        state.messages = extractMessages(sessionPayload).map((item, index) => normalizeMessage(item, index));
      } catch (error) {
        if (requestId !== sessionRequestId || state.selectedSessionId !== sessionId) return;
        state.sessionError = error instanceof Error ? error.message : String(error);
      } finally {
        if (requestId !== sessionRequestId || state.selectedSessionId !== sessionId) return;
        state.sessionLoading = false;
        renderMessagesPanel();
      }
    }

    function downloadBlob(content, filename, mime) {
      const blob = content instanceof Blob ? content : new Blob([content], { type: mime || "text/plain" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    function sessionExportBaseName() {
      const raw = state.sessionData?.title || getSelectedSession()?.title || "session";
      const slug = String(raw)
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60);
      return slug || "session";
    }

    async function exportSession(format, isPlugin) {
      if (!state.selectedSessionId || !format) return;
      const base = sessionExportBaseName();

      try {
        if (isPlugin) {
          const plugin = (window.OCV?.listExportFormats?.() ?? []).find((item) => item.id === format);
          if (!plugin) return;
          const content = plugin.build({ session: state.sessionData, messages: state.messages, state });
          downloadBlob(content, `${base}.${plugin.extension || "txt"}`, plugin.mime || "text/plain");
          return;
        }

        const url = `/api/sessions/${encodeURIComponent(state.selectedSessionId)}/export?format=${encodeURIComponent(format)}`;
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Export failed (HTTP ${response.status})`);
        const blob = await response.blob();
        const extension = format === "json" ? "json" : "md";
        downloadBlob(blob, `${base}.${extension}`, blob.type);
      } catch (error) {
        console.error("Export failed:", error);
        alert(`Export failed: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        if (state.exportMenuOpen) {
          state.exportMenuOpen = false;
          renderMessagesPanel();
        }
      }
    }

    function runSessionAction(actionId) {
      const action = (window.OCV?.listSessionActions?.() ?? []).find((item) => item.id === actionId);
      if (!action) return;
      try {
        action.handler({ session: state.sessionData, messages: state.messages, state });
      } catch (error) {
        console.error("OCV session action failed:", error);
      }
    }

    function clearSelectedSession() {
      state.selectedSessionId = null;
      state.sessionLoading = false;
      state.sessionError = null;
      state.sessionData = null;
      state.messages = [];
      state.sessionStack = [];
      renderSessionsPanel();
      renderMessagesPanel();
    }

    function clearSelectedProject() {
      if (sessionsSearchDebounceTimer) {
        clearTimeout(sessionsSearchDebounceTimer);
        sessionsSearchDebounceTimer = null;
      }
      state.selectedProjectId = null;
      state.sessions = [];
      state.sessionsLoading = false;
      state.sessionsLoadingMore = false;
      state.sessionsError = null;
      state.sessionsPage = 1;
      state.sessionsHasMore = false;
      state.sessionsTotal = null;
      state.sessionsQuery = "";
      state.sessionsScope = "all";
      clearSelectedSession();
      renderProjectsPanel();
      renderSessionsPanel();
    }

    function getMessagesScrollTop() {
      const panelBody = el.messages.querySelector(".panel-body");
      return panelBody ? panelBody.scrollTop : 0;
    }

    function restoreMessagesScrollTop(scrollTop) {
      requestAnimationFrame(() => {
        const panelBody = el.messages.querySelector(".panel-body");
        if (!panelBody) return;
        panelBody.scrollTop = Number.isFinite(scrollTop) ? scrollTop : 0;
      });
    }

    async function navigateBack() {
      const previous = state.sessionStack.pop();
      if (!previous?.sessionId) return;
      await loadSession(previous.sessionId);
      restoreMessagesScrollTop(previous.scrollTop);
    }

    async function onAction(action, target) {
      if (action === "select-project") {
        const projectId = target.dataset.projectId;
        if (!projectId || projectId === state.selectedProjectId) return;

        if (sessionsSearchDebounceTimer) {
          clearTimeout(sessionsSearchDebounceTimer);
          sessionsSearchDebounceTimer = null;
        }
        state.selectedProjectId = projectId;
        state.sessions = [];
        state.sessionsError = null;
        state.sessionsHasMore = false;
        state.sessionsQuery = "";
        state.sessionsScope = "all";
        clearSelectedSession();
        renderProjectsPanel();
        renderSessionsPanel();
        loadSessions({ reset: true });
        return;
      }

      if (action === "select-session") {
        const sessionId = target.dataset.sessionId;
        if (!sessionId) return;
        state.sessionStack = [];
        await loadSession(sessionId);
        return;
      }

      if (action === "navigate-subagent") {
        const sessionId = target.dataset.sessionId;
        if (!sessionId || !state.selectedSessionId || sessionId === state.selectedSessionId) return;

        state.sessionStack.push({
          sessionId: state.selectedSessionId,
          scrollTop: getMessagesScrollTop()
        });

        await loadSession(sessionId);
        return;
      }

      if (action === "navigate-back") {
        if (!state.sessionStack.length) return;
        await navigateBack();
        return;
      }

      if (action === "load-more-sessions") {
        loadSessions({ reset: false });
        return;
      }

      if (action === "toggle-result") {
        const shortEl = document.getElementById(target.dataset.shortId || "");
        const fullEl = document.getElementById(target.dataset.fullId || "");
        if (!shortEl || !fullEl) return;

        const expanded = target.dataset.expanded === "true";
        if (expanded) {
          shortEl.hidden = false;
          fullEl.hidden = true;
          target.dataset.expanded = "false";
          target.textContent = "Show more";
        } else {
          shortEl.hidden = true;
          fullEl.hidden = false;
          target.dataset.expanded = "true";
          target.textContent = "Show less";
        }
        return;
      }

      if (action === "toggle-message-outline") {
        state.messageOutlineCollapsed = !state.messageOutlineCollapsed;
        renderMessagesPanel();
        return;
      }

      if (action === "toggle-export-menu") {
        state.exportMenuOpen = !state.exportMenuOpen;
        renderMessagesPanel();
        return;
      }

      if (action === "export-session") {
        state.exportMenuOpen = false;
        await exportSession(target.dataset.format, target.dataset.plugin === "true");
        return;
      }

      if (action === "plugin-session-action") {
        runSessionAction(target.dataset.actionId);
        return;
      }

      if (action === "toggle-select-mode") {
        state.selectMode = !state.selectMode;
        if (!state.selectMode) {
          state.selectedProjectIds.clear();
          state.selectedSessionIds.clear();
        }
        renderProjectsPanel();
        renderSessionsPanel();
        renderBulkBar();
        return;
      }

      if (action === "toggle-project-select") {
        const projectId = target.dataset.projectId;
        if (!projectId) return;
        if (state.selectedProjectIds.has(projectId)) state.selectedProjectIds.delete(projectId);
        else state.selectedProjectIds.add(projectId);
        renderProjectsPanel();
        renderBulkBar();
        return;
      }

      if (action === "toggle-session-select") {
        const sessionId = target.dataset.sessionId;
        if (!sessionId) return;
        if (state.selectedSessionIds.has(sessionId)) state.selectedSessionIds.delete(sessionId);
        else state.selectedSessionIds.add(sessionId);
        renderSessionsPanel();
        renderBulkBar();
        return;
      }

      if (action === "bulk-clear") {
        state.selectedProjectIds.clear();
        state.selectedSessionIds.clear();
        renderProjectsPanel();
        renderSessionsPanel();
        renderBulkBar();
        return;
      }

      if (action === "bulk-run") {
        const actionDef = (window.OCV?.listBulkActions?.() ?? []).find((item) => item.id === target.dataset.bulkId);
        if (!actionDef) return;
        try {
          await actionDef.handler({
            projectIds: [...state.selectedProjectIds],
            sessionIds: [...state.selectedSessionIds],
            host: window.OCV?.host
          });
        } catch (error) {
          console.error("Bulk action failed:", error);
          alert(`Action failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }

      if (action === "toggle-plugins") {
        state.pluginsOpen = !state.pluginsOpen;
        renderPluginsDialog();
        renderProjectsPanel();
        return;
      }

      if (action === "close-plugins") {
        state.pluginsOpen = false;
        renderPluginsDialog();
        renderProjectsPanel();
        return;
      }

      if (action === "scroll-message") {
        const messageId = target.dataset.messageId;
        if (!messageId) return;

        const messageEl = document.getElementById(messageDomId(messageId));
        if (!messageEl) return;
        messageEl.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }

    function handleSessionsSearchInput(target) {
      const trimmed = (target.value ?? "").trim();
      if (target.value !== trimmed) target.value = trimmed;
      state.sessionsQuery = trimmed;
      if (sessionsSearchDebounceTimer) clearTimeout(sessionsSearchDebounceTimer);
      if (!trimmed) {
        sessionsSearchDebounceTimer = null;
        loadSessions({ reset: true });
        return;
      }
      sessionsSearchDebounceTimer = setTimeout(() => {
        sessionsSearchDebounceTimer = null;
        loadSessions({ reset: true });
      }, 300);
    }

    document.addEventListener("input", (event) => {
      const target = event.target;
      if (!target || target.dataset?.action !== "search-sessions") return;
      handleSessionsSearchInput(target);
    });

    document.addEventListener("search", (event) => {
      const target = event.target;
      if (!target || target.dataset?.action !== "search-sessions") return;
      handleSessionsSearchInput(target);
    }, true);

    document.addEventListener("change", (event) => {
      const target = event.target;
      if (!target) return;

      if (target.dataset?.action === "toggle-plugin") {
        window.OCV?.setEnabled?.(target.dataset.pluginId, target.checked);
        return;
      }

      if (target.dataset?.action !== "scope-sessions") return;

      const value = target.value;
      state.sessionsScope = value === "user" || value === "assistant" ? value : "all";
      if (sessionsSearchDebounceTimer) {
        clearTimeout(sessionsSearchDebounceTimer);
        sessionsSearchDebounceTimer = null;
      }
      loadSessions({ reset: true });
    });

    document.addEventListener("click", (event) => {
      if (event.target.classList?.contains("part-image")) {
        event.preventDefault();
        const src = event.target.src;
        if (!src) return;

        const overlay = document.createElement("div");
        overlay.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:pointer;padding:20px;";
        const img = document.createElement("img");
        img.src = src;
        img.style.cssText = "max-width:100%;max-height:100%;object-fit:contain;border-radius:8px;";
        overlay.appendChild(img);
        overlay.addEventListener("click", () => overlay.remove());
        document.body.appendChild(overlay);
        return;
      }

      if (event.target.classList?.contains("modal-overlay")) {
        state.pluginsOpen = false;
        renderPluginsDialog();
        renderProjectsPanel();
        return;
      }

      const target = event.target.closest("[data-action]");
      if (!target) return;
      if (
        target.dataset.action === "search-sessions" ||
        target.dataset.action === "scope-sessions" ||
        target.dataset.action === "toggle-plugin"
      ) {
        return;
      }
      event.preventDefault();
      void onAction(target.dataset.action, target);
    });

    document.addEventListener("keydown", async (event) => {
      if (event.key !== "Escape") return;

      const overlay = document.querySelector("div[style*='z-index:9999']");
      if (overlay) {
        overlay.remove();
        return;
      }

      const activeEl = document.activeElement;
      if (activeEl && activeEl.dataset?.action === "search-sessions") {
        event.preventDefault();
        if (state.sessionsQuery) {
          state.sessionsQuery = "";
          activeEl.value = "";
          if (sessionsSearchDebounceTimer) {
            clearTimeout(sessionsSearchDebounceTimer);
            sessionsSearchDebounceTimer = null;
          }
          loadSessions({ reset: true });
          return;
        }

        activeEl.blur();
        return;
      }

      if (state.sessionStack.length > 0) {
        event.preventDefault();
        await navigateBack();
        return;
      }

      if (state.selectedSessionId) {
        clearSelectedSession();
        return;
      }

      if (state.selectedProjectId) {
        clearSelectedProject();
      }
    });

    function initialRender() {
      renderProjectsPanel();
      renderSessionsPanel();
      renderMessagesPanel();
      renderBulkBar();
      renderPluginsDialog();
    }

    if (window.OCV?.host) {
      Object.assign(window.OCV.host, {
        getProjects: () => state.projects.map((project) => ({ id: project.id, name: project.name, worktree: project.worktree })),
        getSessions: () => state.sessions.map((session) => ({ id: session.id, title: session.title, projectId: session.projectId })),
        getSelection: () => ({
          projectIds: [...state.selectedProjectIds],
          sessionIds: [...state.selectedSessionIds]
        }),
        clearSelection: () => {
          state.selectedProjectIds.clear();
          state.selectedSessionIds.clear();
          renderProjectsPanel();
          renderSessionsPanel();
          renderBulkBar();
        },
        download: (filename, content, mime) => downloadBlob(content, filename, mime),
        createZip: (entries) => window.OCV.helpers.createZip(entries),
        notify: (message) => console.log("[OCV]", message),
        refresh: () => {
          loadProjects();
          if (state.selectedProjectId) loadSessions({ reset: true });
        },
        render: () => {
          renderProjectsPanel();
          renderSessionsPanel();
          renderMessagesPanel();
          renderBulkBar();
        },
        onPluginsChanged: () => {
          if (!hasBulkActions()) {
            state.selectMode = false;
            state.selectedProjectIds.clear();
            state.selectedSessionIds.clear();
          }
          renderProjectsPanel();
          renderSessionsPanel();
          renderMessagesPanel();
          renderBulkBar();
          renderPluginsDialog();
        },
        api: {
          getProjectSessions: async (projectId) => {
            const sessions = [];
            let page = 1;
            const limit = 200;
            while (true) {
              const payload = await fetchJson(`/api/projects/${encodeURIComponent(projectId)}/sessions?page=${page}&limit=${limit}`);
              const items = Array.isArray(payload?.sessions) ? payload.sessions : [];
              sessions.push(...items);
              const total = Number(payload?.total);
              if (!Number.isFinite(total) || sessions.length >= total || items.length === 0 || page > 100) break;
              page += 1;
            }
            return sessions;
          },
          getSessionDetail: (sessionId) => fetchJson(`/api/sessions/${encodeURIComponent(sessionId)}`),
          deleteProject: async (id) => {
            const response = await fetch(`/api/projects/${encodeURIComponent(id)}`, { method: "DELETE" });
            if (!response.ok) throw new Error(`Delete project failed (HTTP ${response.status})`);
            return response.json();
          },
          deleteSession: async (id) => {
            const response = await fetch(`/api/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
            if (!response.ok) throw new Error(`Delete session failed (HTTP ${response.status})`);
            return response.json();
          }
        }
      });
    }

    async function loadPlugins() {
      try {
        const payload = await fetchJson("/api/plugins");
        const files = Array.isArray(payload?.plugins) ? payload.plugins : [];
        for (const file of files) {
          await new Promise((resolve) => {
            const script = document.createElement("script");
            script.src = `/plugins/${encodeURIComponent(file)}`;
            script.onload = resolve;
            script.onerror = resolve;
            document.head.appendChild(script);
          });
        }
        window.OCV?._activateAll?.();
        window.OCV?._markReady?.();
      } catch (error) {
        console.warn("Failed to load plugins:", error);
      }
    }

    (async () => {
      await loadPlugins();
      initialRender();
      loadProjects();
    })();
