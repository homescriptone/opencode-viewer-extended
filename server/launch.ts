import { Database } from "bun:sqlite";
import { Buffer } from "node:buffer";
import { randomInt } from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";

import {
  PORT,
  corsHeaders,
  json,
  notFound,
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
} from "./database";

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (req.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
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

      const sessionDetailMatch = pathname.match(/^\/api\/sessions\/([^/]+)$/);
      if (sessionDetailMatch) {
        const sessionId = decodeURIComponent(sessionDetailMatch[1]);
        const session = sessionStmt.get(sessionId) as SessionDetailRow | null;

        if (!session) {
          return notFound("Session not found");
        }

        const rows = sessionMessagesStmt.all(sessionId);
        const subagentRows = subagentsStmt.all(sessionId);

        const messageMap = new Map<
          string,
          {
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
            parts: Array<
              {
                id: string;
                time_created: number | string | null;
              } & JsonObject
            >;
          }
        >();

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

          if (!row.part_id || !row.part_data) {
            continue;
          }

          const partData = parseJSON(row.part_data);
          const partType = getString(partData?.type);

          if (!partData || !partType || !allowedPartTypes.has(partType)) {
            continue;
          }

          const message = messageMap.get(row.id);
          if (!message) continue;

          const sanitizedPartData = sanitizePartData(partData, partType);

          message.parts.push({
            id: row.part_id,
            time_created: row.part_time,
            ...sanitizedPartData,
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

        return json({
          session,
          messages,
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
