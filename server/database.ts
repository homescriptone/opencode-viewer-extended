import { Database, type SQLQueryBindings } from "bun:sqlite";
import { randomInt, randomUUID } from "node:crypto";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname, join, normalize } from "node:path";

export const PORT = Number(process.env.OCV_PORT) || randomInt(3000, 4500);
const DB_PATH =
  process.env.OCV_DB_PATH ||
  join(homedir(), ".local", "share", "opencode", "opencode.db");
export const PUBLIC_DIR = join(import.meta.dir, "..", "public");

export const WRITE_ENABLED = process.env.OCV_WRITE === "1";

if (!existsSync(DB_PATH)) {
  console.error(`OpenCode database not found at: ${DB_PATH}`);
  process.exit(1);
}

let db: Database;

try {
  db = WRITE_ENABLED ? new Database(DB_PATH) : new Database(DB_PATH, { readonly: true });
} catch (error) {
  console.error("Failed to open OpenCode database:", error);
  process.exit(1);
}

if (WRITE_ENABLED) {
  try {
    db.exec("PRAGMA foreign_keys = ON");
  } catch {
    /* foreign keys already enabled or unsupported; cascades still defined in schema */
  }
  console.warn(
    "Write mode ENABLED (OCV_WRITE=1): create/update/delete operations are available.",
  );
}

try {
  // Keep the WAL from growing unbounded: after each checkpoint it is truncated
  // down to at most this size (64 MB).
  db.exec("PRAGMA journal_size_limit = 67108864");
} catch {
  /* not supported */
}

export type JsonObject = Record<string, unknown>;

export type ProjectRow = {
  id: string;
  worktree: string | null;
  name: string | null;
  icon_color: string | null;
  time_created: number | string | null;
  time_updated: number | string | null;
};

export type SessionRow = {
  id: string;
  project_id?: string | null;
  project_name?: string | null;
  project_worktree?: string | null;
  title: string | null;
  summary: string | null;
  directory: string | null;
  time_created: number | string | null;
  time_updated: number | string | null;
};

export type Scope = "all" | "user" | "assistant";

export type SessionDetailRow = {
  id: string;
  project_id: string | null;
  parent_id: string | null;
  title: string | null;
  summary: string | null;
  directory: string | null;
  time_created: number | string | null;
  time_updated: number | string | null;
};

export type MessagePartJoinRow = {
  id: string;
  time_created: number | string | null;
  time_updated: number | string | null;
  message_data: string | null;
  part_id: string | null;
  part_data: string | null;
  part_time: number | string | null;
};

export const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export const allowedPartTypes = new Set([
  "text",
  "reasoning",
  "tool",
  "patch",
  "file",
  "agent",
  "step-finish",
  "step-start",
  "snapshot",
  "compaction",
  "retry",
]);

export const projectStmt = db.query<ProjectRow, SQLQueryBindings[]>(
  "SELECT id, worktree, name, icon_color, time_created, time_updated FROM project ORDER BY time_updated DESC",
);

export const sessionsCountNoQueryStmt = db.query<{ total: number }, SQLQueryBindings[]>(
  `SELECT COUNT(*) as total
   FROM session
   WHERE project_id = ? AND parent_id IS NULL`,
);

export const projectSessionsNoQueryStmt = db.query<SessionRow, SQLQueryBindings[]>(
  `SELECT id, title, NULL as summary, directory, time_created, time_updated
   FROM session
   WHERE project_id = ? AND parent_id IS NULL
   ORDER BY time_updated DESC, id DESC
   LIMIT ? OFFSET ?`,
);

export function buildSearchStatements(scope: Scope) {
  const roleClause =
    scope === "all" ? "" : `AND json_extract(m.data, '$.role') = '${scope}'`;
  const commonWhere = `
    WHERE s.project_id = ?
      AND s.parent_id IS NULL
      AND (
        instr(lower(s.title), ?) > 0
        OR EXISTS (
          SELECT 1
          FROM message m
          JOIN part p ON p.message_id = m.id
          WHERE m.session_id = s.id
            AND json_extract(p.data, '$.type') IN ('text','reasoning')
            AND instr(lower(json_extract(p.data, '$.text')), ?) > 0
            ${roleClause}
        )
      )
  `;

  return {
    list: db.query<SessionRow, SQLQueryBindings[]>(
      `SELECT s.id, s.title, NULL as summary, s.directory, s.time_created, s.time_updated
       FROM session s
       ${commonWhere}
       ORDER BY s.time_updated DESC, s.id DESC
       LIMIT ? OFFSET ?`,
    ),
    count: db.query<{ total: number }, SQLQueryBindings[]>(
      `SELECT COUNT(*) as total
       FROM session s
       ${commonWhere}`,
    ),
  };
}

export const searchStmts: Record<Scope, ReturnType<typeof buildSearchStatements>> = {
  all: buildSearchStatements("all"),
  user: buildSearchStatements("user"),
  assistant: buildSearchStatements("assistant"),
};

export function buildGlobalSearchStatements(scope: Scope) {
  const roleClause =
    scope === "all" ? "" : `AND json_extract(m.data, '$.role') = '${scope}'`;
  const commonWhere = `
    WHERE s.parent_id IS NULL
      AND (
        instr(lower(s.title), ?) > 0
        OR EXISTS (
          SELECT 1
          FROM message m
          JOIN part p ON p.message_id = m.id
          WHERE m.session_id = s.id
            AND json_extract(p.data, '$.type') IN ('text','reasoning')
            AND instr(lower(json_extract(p.data, '$.text')), ?) > 0
            ${roleClause}
        )
      )
  `;

  return {
    list: db.query<SessionRow, SQLQueryBindings[]>(
      `SELECT s.id, s.project_id, project.name as project_name, project.worktree as project_worktree,
              s.title, NULL as summary, s.directory, s.time_created, s.time_updated
       FROM session s
       LEFT JOIN project ON project.id = s.project_id
       ${commonWhere}
       ORDER BY s.time_updated DESC, s.id DESC
       LIMIT ? OFFSET ?`,
    ),
    count: db.query<{ total: number }, SQLQueryBindings[]>(
      `SELECT COUNT(*) as total
       FROM session s
       ${commonWhere}`,
    ),
  };
}

export const globalSearchStmts: Record<Scope, ReturnType<typeof buildGlobalSearchStatements>> = {
  all: buildGlobalSearchStatements("all"),
  user: buildGlobalSearchStatements("user"),
  assistant: buildGlobalSearchStatements("assistant"),
};

export const sessionStmt = db.query<SessionDetailRow, SQLQueryBindings[]>(
  "SELECT id, project_id, parent_id, title, NULL as summary, directory, time_created, time_updated FROM session WHERE id = ?",
);

export const sessionMessagesStmt = db.query<MessagePartJoinRow, SQLQueryBindings[]>(
  `SELECT m.id, m.time_created, m.time_updated, m.data as message_data,
          p.id as part_id, p.data as part_data, p.time_created as part_time
   FROM message m
   LEFT JOIN part p ON p.message_id = m.id
   WHERE m.session_id = ?
   ORDER BY m.time_created ASC, p.time_created ASC`,
);

export const subagentsStmt = db.query<SessionRow, SQLQueryBindings[]>(
  `SELECT id, title, NULL as summary, NULL as directory, time_created, time_updated
   FROM session
   WHERE parent_id = ?
   ORDER BY time_created ASC`,
);

export const partImageStmt = db.query<{ data: string }, SQLQueryBindings[]>("SELECT data FROM part WHERE id = ?");

export function listPlugins(): string[] {
  const pluginsDir = join(PUBLIC_DIR, "plugins");
  if (!existsSync(pluginsDir)) return [];
  return readdirSync(pluginsDir)
    .filter((name) => name.endsWith(".js"))
    .sort();
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "")}`;
}

export const insertProjectStmt = db.query(
  `INSERT INTO project (id, worktree, name, icon_color, time_created, time_updated, sandboxes)
   VALUES (?, ?, ?, ?, ?, ?, '[]')`,
);

export const insertSessionStmt = db.query(
  `INSERT INTO session (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

export const insertMessageStmt = db.query(
  `INSERT INTO message (id, session_id, time_created, time_updated, data)
   VALUES (?, ?, ?, ?, ?)`,
);

export const insertPartStmt = db.query(
  `INSERT INTO part (id, message_id, session_id, time_created, time_updated, data)
   VALUES (?, ?, ?, ?, ?, ?)`,
);

export const deleteProjectStmt = db.query("DELETE FROM project WHERE id = ?");
export const deleteSessionStmt = db.query("DELETE FROM session WHERE id = ?");
export const deleteMessageStmt = db.query("DELETE FROM message WHERE id = ?");
export const deletePartStmt = db.query("DELETE FROM part WHERE id = ?");

const projectExistsStmt = db.query<{ id: string }, SQLQueryBindings[]>("SELECT id FROM project WHERE id = ?");
const sessionExistsStmt = db.query<{ id: string }, SQLQueryBindings[]>("SELECT id FROM session WHERE id = ?");

export function databaseSize(): number {
  try {
    return statSync(DB_PATH).size;
  } catch {
    return 0;
  }
}

function pragmaNumber(name: string, fallback: number): number {
  try {
    const row = db.query<Record<string, number>, SQLQueryBindings[]>(`PRAGMA ${name}`).get();
    if (!row) return fallback;
    const value = Object.values(row)[0];
    return typeof value === "number" ? value : fallback;
  } catch {
    return fallback;
  }
}

// Cap SQLite's page cache so heavy operations don't balloon process memory.
function limitMemory(): void {
  try {
    db.exec("PRAGMA cache_size = -65536"); // ~64 MB
    db.exec("PRAGMA temp_store = FILE");
    db.exec("PRAGMA mmap_size = 0"); // don't map the whole file into memory
  } catch {
    /* best effort */
  }
}

export function walSize(): number {
  try {
    return statSync(`${DB_PATH}-wal`).size;
  } catch {
    return 0;
  }
}

function journalMode(): string {
  try {
    const row = db.query<Record<string, unknown>, SQLQueryBindings[]>("PRAGMA journal_mode").get();
    const value = row ? Object.values(row)[0] : undefined;
    return typeof value === "string" ? value : "unknown";
  } catch {
    return "unknown";
  }
}

// Flush the write-ahead log back into the database and truncate the `-wal` file
// to zero. This is what actually shrinks the WAL after heavy writes.
export function checkpointWal(): {
  busy: number;
  logPages: number;
  checkpointedPages: number;
  walSize: number;
} {
  let busy = -1;
  let logPages = 0;
  let checkpointedPages = 0;
  try {
    const row = db
      .query<Record<string, number>, SQLQueryBindings[]>("PRAGMA wal_checkpoint(TRUNCATE)")
      .get();
    if (row) {
      const values = Object.values(row).map(Number);
      busy = values[0] ?? -1;
      logPages = values[1] ?? 0;
      checkpointedPages = values[2] ?? 0;
    }
  } catch {
    /* not in WAL mode or unsupported */
  }
  return { busy, logPages, checkpointedPages, walSize: walSize() };
}

export type DbInfo = {
  size: number;
  pageSize: number;
  pageCount: number;
  freelistPages: number;
  reclaimableBytes: number;
  autoVacuum: number;
  journalMode: string;
  walSize: number;
};

export function dbInfo(): DbInfo {
  const pageSize = pragmaNumber("page_size", 4096);
  const pageCount = pragmaNumber("page_count", 0);
  const freelistPages = pragmaNumber("freelist_count", 0);
  const autoVacuum = pragmaNumber("auto_vacuum", 0);
  return {
    size: databaseSize(),
    pageSize,
    pageCount,
    freelistPages,
    reclaimableBytes: freelistPages * pageSize,
    autoVacuum,
    journalMode: journalMode(),
    walSize: walSize(),
  };
}

// SQLite keeps freed pages for reuse after DELETE, so the file does not shrink
// on its own. A full VACUUM rewrites the whole file (slow, memory/disk heavy).
export function vacuumDatabase(): { sizeBefore: number; sizeAfter: number } {
  limitMemory();
  const sizeBefore = databaseSize();
  db.exec("VACUUM");
  db.exec("PRAGMA optimize");
  checkpointWal();
  const sizeAfter = databaseSize();
  return { sizeBefore, sizeAfter };
}

// One-time switch to incremental auto-vacuum (requires a full rewrite), after
// which `incrementalVacuumStep` can reclaim space in small batches.
export function convertToIncremental(): DbInfo {
  limitMemory();
  db.exec("PRAGMA auto_vacuum = INCREMENTAL");
  db.exec("VACUUM");
  db.exec("PRAGMA optimize");
  checkpointWal();
  return dbInfo();
}

// Reclaim up to `maxPages` free pages (roughly maxPages * pageSize bytes) from
// the end of the file. Works only when auto_vacuum is INCREMENTAL or FULL.
export function incrementalVacuumStep(maxPages: number): DbInfo {
  limitMemory();
  db.exec(`PRAGMA incremental_vacuum(${Math.max(1, Math.floor(maxPages))})`);
  checkpointWal();
  return dbInfo();
}

export type EventLogInfo = {
  available: boolean;
  events: number;
  aggregates: number;
  orphanedAggregates: number;
  orphanedEvents: number;
};

// OpenCode's event-sourcing log lives in `event` (one row per change) with one
// `event_sequence` row per aggregate (a session id). Nothing there is
// foreign-keyed to `session`, so deleting a session leaves its events behind.
export function eventLogInfo(): EventLogInfo {
  try {
    const events =
      db.query<{ total: number }, SQLQueryBindings[]>("SELECT COUNT(*) as total FROM event").get()
        ?.total ?? 0;
    const aggregates =
      db
        .query<{ total: number }, SQLQueryBindings[]>(
          "SELECT COUNT(*) as total FROM event_sequence",
        )
        .get()?.total ?? 0;
    const orphanedAggregates =
      db
        .query<{ total: number }, SQLQueryBindings[]>(
          `SELECT COUNT(*) as total FROM event_sequence
           WHERE aggregate_id NOT IN (SELECT id FROM session)`,
        )
        .get()?.total ?? 0;
    const liveEvents =
      db
        .query<{ total: number }, SQLQueryBindings[]>(
          `SELECT COUNT(*) as total FROM event
           WHERE aggregate_id IN (SELECT id FROM session)`,
        )
        .get()?.total ?? 0;

    return {
      available: true,
      events,
      aggregates,
      orphanedAggregates,
      orphanedEvents: Math.max(0, events - liveEvents),
    };
  } catch {
    return {
      available: false,
      events: 0,
      aggregates: 0,
      orphanedAggregates: 0,
      orphanedEvents: 0,
    };
  }
}

// Delete the event log for aggregates whose session no longer exists. Events are
// removed before their `event_sequence` row so this does not depend on foreign
// keys being enabled. Work is chunked to avoid one giant write transaction.
export function purgeOrphanedEvents(): { aggregates: number; events: number } {
  let orphans: string[] = [];
  try {
    orphans = db
      .query<{ aggregate_id: string }, SQLQueryBindings[]>(
        `SELECT aggregate_id FROM event_sequence
         WHERE aggregate_id NOT IN (SELECT id FROM session)`,
      )
      .all()
      .map((row) => row.aggregate_id);
  } catch {
    return { aggregates: 0, events: 0 };
  }

  if (!orphans.length) return { aggregates: 0, events: 0 };

  const deleteEvents = db.query("DELETE FROM event WHERE aggregate_id = ?");
  const deleteSequence = db.query("DELETE FROM event_sequence WHERE aggregate_id = ?");
  const chunkSize = 25;
  let events = 0;
  let aggregates = 0;

  for (let offset = 0; offset < orphans.length; offset += chunkSize) {
    const batch = orphans.slice(offset, offset + chunkSize);
    const runBatch = db.transaction((ids: string[]) => {
      let removed = 0;
      for (const id of ids) {
        const result = deleteEvents.run(id);
        removed += Number(result.changes ?? 0);
        deleteSequence.run(id);
      }
      return removed;
    });
    events += Number(runBatch(batch) ?? 0);
    aggregates += batch.length;
  }

  checkpointWal();
  return { aggregates, events };
}

// Delete many rows for one table in small transactions (chunks). This avoids one
// giant write transaction / lock while staying far faster than one request per id.
export function deleteByIds(
  table: "project" | "session",
  ids: string[],
  chunkSize = 250,
): number {
  const statement = table === "project" ? deleteProjectStmt : deleteSessionStmt;
  const exists = table === "project" ? projectExistsStmt : sessionExistsStmt;
  let deleted = 0;

  for (let offset = 0; offset < ids.length; offset += chunkSize) {
    const chunk = ids.slice(offset, offset + chunkSize);
    const runChunk = db.transaction((batch: string[]) => {
      let count = 0;
      for (const id of batch) {
        if (exists.get(id)) {
          statement.run(id);
          count += 1;
        }
      }
      return count;
    });
    deleted += runChunk(chunk) as number;
  }

  checkpointWal();
  return deleted;
}

const UPDATABLE_COLUMNS: Record<string, string[]> = {
  project: ["worktree", "name", "icon_color", "icon_url", "icon_url_override", "vcs"],
  session: [
    "project_id",
    "parent_id",
    "title",
    "slug",
    "directory",
    "version",
    "share_url",
    "agent",
    "model",
    "summary_additions",
    "summary_deletions",
    "summary_files",
    "time_archived",
    "time_compacting",
  ],
  message: ["session_id", "data"],
  part: ["message_id", "session_id", "data"],
};

export function updateRow(
  table: keyof typeof UPDATABLE_COLUMNS,
  id: string,
  fields: JsonObject,
): number {
  const allowed = UPDATABLE_COLUMNS[table];
  const keys = Object.keys(fields).filter((key) => allowed.includes(key));
  const values = keys.map((key) => fields[key] as string | number | null);

  keys.push("time_updated");
  values.push(Date.now());

  const setClause = keys.map((key) => `${key} = ?`).join(", ");
  const statement = db.query(`UPDATE ${table} SET ${setClause} WHERE id = ?`);
  const result = statement.run(...values, id);
  return result.changes;
}

export function parseJSON(value: string | null): JsonObject | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object") return parsed as JsonObject;
    return null;
  } catch {
    return null;
  }
}

 export function getString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function isBase64ImageData(value: unknown): boolean {
  return typeof value === "string" && value.startsWith("data:image");
}

export function sanitizePartData(partData: JsonObject, partType: string): JsonObject {
  const sanitizedPartData: JsonObject = { ...partData };

  if (partType === "file") {
    const fileUrl = getString(sanitizedPartData.url);
    if (fileUrl && fileUrl.startsWith("data:image")) {
      sanitizedPartData.url = "[base64-image]";
      sanitizedPartData.hasImage = true;
    }
  }

  if (partType === "tool") {
    const state = sanitizedPartData.state;
    if (state && typeof state === "object" && !Array.isArray(state)) {
      const stateObject = state as JsonObject;
      const attachments = stateObject.attachments;

      if (Array.isArray(attachments)) {
        const hasBase64ImageAttachment = attachments.some((attachment) => {
          if (isBase64ImageData(attachment)) {
            return true;
          }

          if (attachment && typeof attachment === "object") {
            const attachmentObject = attachment as JsonObject;
            return (
              isBase64ImageData(attachmentObject.url) ||
              isBase64ImageData(attachmentObject.data) ||
              isBase64ImageData(attachmentObject.content)
            );
          }

          return false;
        });

        if (hasBase64ImageAttachment) {
          sanitizedPartData.state = {
            ...stateObject,
            attachments: [],
          };
          sanitizedPartData.hasAttachments = true;
        }
      }
    }
  }

  return sanitizedPartData;
}

export function extractPartImageDataUri(partData: JsonObject): string | null {
  const url = partData.url;
  if (typeof url === "string" && url.startsWith("data:image")) {
    return url;
  }

  const state = partData.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    return null;
  }

  const attachments = (state as JsonObject).attachments;
  if (!Array.isArray(attachments)) {
    return null;
  }

  for (const attachment of attachments) {
    if (typeof attachment === "string" && attachment.startsWith("data:image")) {
      return attachment;
    }

    if (attachment && typeof attachment === "object" && !Array.isArray(attachment)) {
      const attachmentUrl = (attachment as JsonObject).url;
      if (typeof attachmentUrl === "string" && attachmentUrl.startsWith("data:image")) {
        return attachmentUrl;
      }
    }
  }

  return null;
}

export function getPagination(url: URL): { page: number; limit: number; offset: number } {
  const pageParam = Number(url.searchParams.get("page") ?? "1");
  const limitParam = Number(url.searchParams.get("limit") ?? "50");

  const page = Number.isFinite(pageParam) && pageParam > 0 ? Math.floor(pageParam) : 1;
  const limit =
    Number.isFinite(limitParam) && limitParam > 0 ? Math.min(Math.floor(limitParam), 200) : 50;

  return { page, limit, offset: (page - 1) * limit };
}

export function normalizeScope(raw: string | null): Scope {
  const value = (raw ?? "all").toLowerCase();
  return value === "user" || value === "assistant" ? value : "all";
}

export function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

export function withCors(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function notFound(message = "Not found"): Response {
  return json({ error: message }, 404);
}

export function badRequest(message: string): Response {
  return json({ error: message }, 400);
}

export async function serveStatic(pathname: string): Promise<Response> {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const safePath = normalize(relativePath).replace(/^\.{2}(\/|\\|$)/, "");
  const filePath = join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return notFound();
  }

  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    return notFound();
  }

  const file = Bun.file(filePath);

  if (extname(filePath) === ".html") {
    return withCors(
      new Response(file, {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      }),
    );
  }

  return withCors(new Response(file));
}

