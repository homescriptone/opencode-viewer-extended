import { Buffer } from "node:buffer";

import {
  PORT,
  corsHeaders,
  json,
  notFound,
  badRequest,
  serveStatic,
  partImageStmt,
  allowedPartTypes,
  sanitizePartData,
  getString,
  getPagination,
  normalizeScope,
  searchStmts,
  globalSearchStmts,
  projectStmt,
  projectSessionsNoQueryStmt,
  sessionsCountNoQueryStmt,
  sessionStmt,
  sessionMessagesStmt,
  subagentsStmt,
  SessionDetailRow,
  JsonObject,
  parseJSON,
  extractPartImageDataUri,
  newId,
  updateRow,
  insertProjectStmt,
  insertSessionStmt,
  insertMessageStmt,
  insertPartStmt,
  deleteProjectStmt,
  deleteSessionStmt,
  deleteMessageStmt,
  deletePartStmt,
  listPlugins,
} from "./database";

const ENTITY_ROUTES: Array<{
  pattern: RegExp;
  table: "project" | "session" | "message" | "part";
}> = [
  { pattern: /^\/api\/projects\/([^/]+)$/, table: "project" },
  { pattern: /^\/api\/sessions\/([^/]+)$/, table: "session" },
  { pattern: /^\/api\/messages\/([^/]+)$/, table: "message" },
  { pattern: /^\/api\/parts\/([^/]+)$/, table: "part" },
];

const DELETE_BY_TABLE = {
  project: deleteProjectStmt,
  session: deleteSessionStmt,
  message: deleteMessageStmt,
  part: deletePartStmt,
} as const;

function matchEntity(pathname: string): { table: "project" | "session" | "message" | "part"; id: string } | null {
  for (const route of ENTITY_ROUTES) {
    const match = pathname.match(route.pattern);
    if (match) return { table: route.table, id: decodeURIComponent(match[1]) };
  }
  return null;
}

async function readJsonBody(req: Request): Promise<JsonObject | null> {
  try {
    const parsed = (await req.json()) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as JsonObject;
    }
    return null;
  } catch {
    return null;
  }
}

function toJsonText(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value !== null && typeof value === "object") return JSON.stringify(value);
  return null;
}

type SessionMessage = {
  id: string;
  _type?: "subagent";
  time_created: number | string | null;
  time_updated: number | string | null;
  title?: string | null;
  summary?: string | null;
  role: string | null;
  modelID: string | null;
  providerID: string | null;
  agent: string | null;
  cost: number | null;
  tokens: unknown;
  parts: Array<{ id: string; time_created: number | string | null } & JsonObject>;
};

function buildSessionMessages(sessionId: string): SessionMessage[] {
  const rows = sessionMessagesStmt.all(sessionId);
  const subagentRows = subagentsStmt.all(sessionId);
  const messageMap = new Map<string, SessionMessage>();

  for (const row of rows) {
    if (!messageMap.has(row.id)) {
      const messageData = parseJSON(row.message_data);
      const costValue = messageData?.cost;

      messageMap.set(row.id, {
        id: row.id,
        time_created: row.time_created,
        time_updated: row.time_updated,
        role: getString(messageData?.role),
        modelID: getString(messageData?.modelID),
        providerID: getString(messageData?.providerID),
        agent: getString(messageData?.agent),
        cost: typeof costValue === "number" ? costValue : null,
        tokens: messageData?.tokens ?? null,
        parts: [],
      });
    }

    if (!row.part_id || !row.part_data) continue;

    const partData = parseJSON(row.part_data);
    const partType = getString(partData?.type);
    if (!partData || !partType || !allowedPartTypes.has(partType)) continue;

    const message = messageMap.get(row.id);
    if (!message) continue;

    message.parts.push({
      id: row.part_id,
      time_created: row.part_time,
      ...sanitizePartData(partData, partType),
    });
  }

  const messages = Array.from(messageMap.values());

  for (const sub of subagentRows) {
    messages.push({
      id: sub.id,
      _type: "subagent",
      time_created: sub.time_created,
      time_updated: sub.time_updated,
      title: sub.title,
      summary: sub.summary,
      role: null,
      modelID: null,
      providerID: null,
      agent: null,
      cost: null,
      tokens: null,
      parts: [],
    });
  }

  messages.sort((a, b) => {
    const taValue = Number(a.time_created);
    const tbValue = Number(b.time_created);
    const ta = Number.isFinite(taValue) ? taValue : 0;
    const tb = Number.isFinite(tbValue) ? tbValue : 0;
    return ta - tb;
  });

  return messages;
}

function stringifyValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function slugify(value: string): string {
  const slug = String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "session";
}

function sessionToMarkdown(session: SessionDetailRow, messages: SessionMessage[]): string {
  const lines: string[] = [];
  lines.push(`# ${session.title ?? "Untitled session"}`);
  lines.push("");
  lines.push(`- **Session ID:** \`${session.id}\``);
  if (session.project_id) lines.push(`- **Project ID:** \`${session.project_id}\``);
  if (session.directory) lines.push(`- **Directory:** \`${session.directory}\``);
  const updated = Number(session.time_updated);
  if (Number.isFinite(updated) && updated > 0) {
    lines.push(`- **Updated:** ${new Date(updated).toISOString()}`);
  }
  lines.push("");

  for (const message of messages) {
    if (message._type === "subagent") {
      lines.push(`## Subagent: ${message.title ?? message.id}`);
      lines.push("");
      continue;
    }

    const role = String(message.role ?? "unknown");
    lines.push(`## ${role.charAt(0).toUpperCase()}${role.slice(1)}`);
    if (message.modelID) lines.push(`*model: ${message.modelID}*`);
    lines.push("");

    for (const part of message.parts) {
      const type = String(part.type ?? "text");
      if (type === "text" || type === "reasoning") {
        lines.push(stringifyValue(part.text).trim());
        lines.push("");
      } else if (type === "tool") {
        lines.push(`### Tool: ${String(part.tool ?? "unknown")}`);
        lines.push("```json");
        lines.push(stringifyValue(part.state && (part.state as JsonObject).input) || "{}");
        lines.push("```");
        const output = part.state && (part.state as JsonObject).output;
        if (output !== undefined && output !== null) {
          lines.push("");
          lines.push("Output:");
          lines.push("```");
          lines.push(stringifyValue(output).trim());
          lines.push("```");
        }
        lines.push("");
      } else if (type === "patch") {
        const hash = String(part.hash ?? "").slice(0, 7);
        lines.push(`### Patch \`${hash || "unknown"}\``);
        lines.push("");
      } else if (type === "file") {
        lines.push(`### File: ${String(part.filename ?? "attachment")}`);
        lines.push("");
      }
    }
  }

  return lines.join("\n");
}

function textResponse(body: string, contentType: string, filename: string): Response {
  return new Response(body, {
    headers: {
      ...corsHeaders,
      "Content-Type": `${contentType}; charset=utf-8`,
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}

async function handleWrite(req: Request, url: URL): Promise<Response> {
  const { pathname } = url;
  const method = req.method.toUpperCase();
  const now = Date.now();

  if (method === "POST") {
    const body = await readJsonBody(req);
    if (!body) return badRequest("Invalid JSON body");

    if (pathname === "/api/projects") {
      const worktree = getString(body.worktree);
      if (!worktree) return badRequest("worktree is required");
      const id = getString(body.id) ?? newId("proj");
      insertProjectStmt.run(id, worktree, getString(body.name), getString(body.icon_color), now, now);
      return json({ ok: true, id }, 201);
    }

    if (pathname === "/api/sessions") {
      const projectId = getString(body.project_id);
      if (!projectId) return badRequest("project_id is required");
      const id = getString(body.id) ?? newId("ses");
      const parentId = getString(body.parent_id);
      const slug = getString(body.slug) ?? newId("ses");
      const directory = getString(body.directory) ?? "";
      const title = getString(body.title) ?? "Untitled session";
      const version = getString(body.version) ?? "0.0.0";
      try {
        insertSessionStmt.run(id, projectId, parentId, slug, directory, title, version, now, now);
      } catch (error) {
        return badRequest(`Failed to create session: ${String(error)}`);
      }
      return json({ ok: true, id }, 201);
    }

    const messagesMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/messages$/);
    if (messagesMatch) {
      const sessionId = decodeURIComponent(messagesMatch[1]);
      const id = getString(body.id) ?? newId("msg");
      const data = toJsonText(body.data) ?? "{}";
      try {
        insertMessageStmt.run(id, sessionId, now, now, data);
      } catch (error) {
        return badRequest(`Failed to create message: ${String(error)}`);
      }
      return json({ ok: true, id }, 201);
    }

    const partsMatch = pathname.match(/^\/api\/messages\/([^/]+)\/parts$/);
    if (partsMatch) {
      const messageId = decodeURIComponent(partsMatch[1]);
      const sessionId = getString(body.session_id);
      if (!sessionId) return badRequest("session_id is required");
      const id = getString(body.id) ?? newId("prt");
      const data = toJsonText(body.data) ?? "{}";
      try {
        insertPartStmt.run(id, messageId, sessionId, now, now, data);
      } catch (error) {
        return badRequest(`Failed to create part: ${String(error)}`);
      }
      return json({ ok: true, id }, 201);
    }

    return notFound();
  }

  if (method === "PATCH" || method === "PUT") {
    const body = await readJsonBody(req);
    if (!body) return badRequest("Invalid JSON body");
    const target = matchEntity(pathname);
    if (!target) return notFound();
    const changes = updateRow(target.table, target.id, body);
    return json({ ok: true, id: target.id, changed: changes });
  }

  if (method === "DELETE") {
    const target = matchEntity(pathname);
    if (!target) return notFound();
    const result = DELETE_BY_TABLE[target.table].run(target.id);
    return json({ ok: true, id: target.id, deleted: result.changes });
  }

  return json({ error: "Method not allowed" }, 405);
}

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "GET") {
      try {
        return await handleWrite(req, url);
      } catch (error) {
        console.error("Request error:", error);
        return json({ error: "Internal server error" }, 500);
      }
    }

    try {
      const partImageMatch = pathname.match(/^\/api\/parts\/([^/]+)\/image$/);
      if (partImageMatch) {
        const partId = decodeURIComponent(partImageMatch[1]);
        const row = partImageStmt.get(partId) as { data: string } | null;

        if (!row?.data) {
          return notFound("Part not found");
        }

        const partData = parseJSON(row.data);
        if (!partData) {
          return notFound("Invalid part data");
        }

        const dataUri = extractPartImageDataUri(partData);
        if (!dataUri) {
          return notFound("No image in part");
        }

        const match = dataUri.match(/^data:(image\/[^;]+);base64,([\s\S]+)$/);
        if (!match) {
          return notFound("Invalid image data");
        }

        const mime = match[1];
        const base64Payload = match[2].replace(/\s+/g, "");
        const buffer = Buffer.from(base64Payload, "base64");

        if (!buffer.length) {
          return notFound("Invalid image data");
        }

        return new Response(buffer, {
          headers: {
            ...corsHeaders,
            "Content-Type": mime,
            "Cache-Control": "public, max-age=86400",
          },
        });
      }

      if (pathname === "/api/projects") {
        const projects = projectStmt.all();
        return json({ projects });
      }

      if (pathname === "/api/plugins") {
        return json({ plugins: listPlugins() });
      }

      const projectSessionsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/);
      if (projectSessionsMatch) {
        const projectId = decodeURIComponent(projectSessionsMatch[1]);
        const { page, limit, offset } = getPagination(url);
        const qRaw = (url.searchParams.get("q") ?? "").trim();
        const scope = normalizeScope(url.searchParams.get("scope"));

        if (!qRaw) {
          const totalRow = sessionsCountNoQueryStmt.get(projectId) as { total: number } | null;
          const sessions = projectSessionsNoQueryStmt.all(projectId, limit, offset);

          return json({
            projectId,
            page,
            limit,
            total: totalRow?.total ?? 0,
            sessions,
            q: "",
            scope,
          });
        }

        const needle = qRaw.toLowerCase();
        const stmts = searchStmts[scope];
        const totalRow = stmts.count.get(projectId, needle, needle) as { total: number } | null;
        const sessions = stmts.list.all(projectId, needle, needle, limit, offset);

        return json({
          projectId,
          page,
          limit,
          total: totalRow?.total ?? 0,
          sessions,
          q: qRaw,
          scope,
        });
      }

      if (pathname === "/api/sessions/search") {
        const { page, limit, offset } = getPagination(url);
        const qRaw = (url.searchParams.get("q") ?? "").trim();
        const scope = normalizeScope(url.searchParams.get("scope"));

        if (!qRaw) {
          return json({
            page,
            limit,
            total: 0,
            sessions: [],
            q: "",
            scope,
          });
        }

        const needle = qRaw.toLowerCase();
        const stmts = globalSearchStmts[scope];
        const totalRow = stmts.count.get(needle, needle) as { total: number } | null;
        const sessions = stmts.list.all(needle, needle, limit, offset);

        return json({
          page,
          limit,
          total: totalRow?.total ?? 0,
          sessions,
          q: qRaw,
          scope,
        });
      }

      const exportMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/export$/);
      if (exportMatch) {
        const sessionId = decodeURIComponent(exportMatch[1]);
        const session = sessionStmt.get(sessionId) as SessionDetailRow | null;

        if (!session) {
          return notFound("Session not found");
        }

        const messages = buildSessionMessages(sessionId);
        const format = (url.searchParams.get("format") ?? "md").toLowerCase();
        const slug = slugify(session.title ?? "session");

        if (format === "json") {
          return textResponse(
            JSON.stringify({ exportedAt: new Date().toISOString(), session, messages }, null, 2),
            "application/json",
            `${slug}.json`,
          );
        }

        return textResponse(sessionToMarkdown(session, messages), "text/markdown", `${slug}.md`);
      }

      const sessionDetailMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionDetailMatch) {
        const sessionId = decodeURIComponent(sessionDetailMatch[1]);
        const session = sessionStmt.get(sessionId) as SessionDetailRow | null;

        if (!session) {
          return notFound("Session not found");
        }

        return json({
          session,
          messages: buildSessionMessages(sessionId),
        });
      }

      const subagentsMatch = pathname.match(/^\/api\/sessions\/([^/]+)\/subagents$/);
      if (subagentsMatch) {
        const sessionId = decodeURIComponent(subagentsMatch[1]);
        const subagents = subagentsStmt.all(sessionId);
        return json({ sessionId, subagents });
      }

      return await serveStatic(pathname);
    } catch (error) {
      console.error("Request error:", error);
      return json({ error: "Internal server error" }, 500);
    }
  },
});

console.log(`OpenCode Viewer running at http://localhost:${server.port}`);
