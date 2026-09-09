import { promises as fs } from "fs";
import { homedir } from "os";
import { basename, dirname, join, resolve } from "path";
import type { DiscoveredTranscript } from "./discovery";
import { asOpenClawSession, extractOpenClawText, parseOpenClawRecords, type OpenClawRecord } from "./openclaw";
import { createLogger } from "./logger";

const logger = createLogger("openclaw");
type Warning = (message: string) => void;
type Row = Record<string, unknown>;
interface ReadDatabase {
  all(sql: string, ...params: string[]): Row[];
  close(): void;
}

// The published CLI runs in Node as well as Bun. Both native readers open the
// existing database read-only and use a transaction for a consistent WAL snapshot.
async function openDatabase(path: string): Promise<ReadDatabase> {
  await fs.access(path);
  let db: ReadDatabase;
  if (typeof Bun !== "undefined") {
    const { Database } = await import("bun:sqlite");
    const sqlite = new Database(path, { readonly: true });
    db = { all: (sql, ...params) => sqlite.query(sql).all(...params) as Row[], close: () => sqlite.close() };
  } else {
    const { DatabaseSync } = await import("node:sqlite").catch((error: unknown) => {
      throw new Error("OpenClaw SQLite import requires Node.js 22.13+ or Bun 1.3.10+.", { cause: error });
    });
    const sqlite = new DatabaseSync(path, { readOnly: true });
    db = { all: (sql, ...params) => sqlite.prepare(sql).all(...params) as Row[], close: () => sqlite.close() };
  }
  try {
    db.all("BEGIN");
    const tables = new Set(db.all("SELECT name FROM sqlite_master WHERE type = 'table'").map((r) => r.name));
    for (const table of ["session_nodes", "session_windows", "transcript_events", "session_transcript_active_events"]) {
      if (!tables.has(table)) throw new Error(`Unsupported OpenClaw store: missing ${table}`);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function readEvents(db: ReadDatabase, sessionId: string, onWarning?: Warning, previewOnly = false): OpenClawRecord[] {
  // Raw events can include abandoned branches and rewrites. Only the ordered
  // active projection represents the visible transcript. context_eligible is
  // intentionally not filtered: compacted messages still belong in the viewer.
  const rows = db.all(
    `SELECT e.event_json FROM transcript_events e
    JOIN session_transcript_active_events a ON a.session_id = e.session_id AND a.event_seq = e.seq
    WHERE e.session_id = ? ${previewOnly ? "AND CASE WHEN json_valid(e.event_json) THEN json_extract(e.event_json, '$.message.role') = 'user' ELSE 0 END" : ""}
    ORDER BY a.active_position ${previewOnly ? "LIMIT 1" : ""}`,
    sessionId,
  );
  const header = db.all("SELECT event_json FROM transcript_events WHERE session_id = ? AND seq = 0", sessionId);
  const records = parseOpenClawRecords([...header, ...rows].map((r) => r.event_json).join("\n"), onWarning);
  const session = asOpenClawSession(records);
  return [{ ...session, type: "session", id: sessionId }, ...records.filter((r) => r.type !== "session")];
}

export function selectOpenClawBranch(records: OpenClawRecord[]): OpenClawRecord[] {
  const entries = records.filter((r) => r.type !== "session") as Row[];
  const leaf = [...entries].reverse().find((r) => typeof r.id === "string" && "parentId" in r);
  // Older flat exports without ancestry remain readable.
  if (!leaf) return records;
  const byId = new Map(entries.filter((r) => typeof r.id === "string").map((r) => [r.id as string, r]));
  const active = new Set<Row>();
  let current: Row | undefined = leaf;
  while (current && !active.has(current)) {
    active.add(current);
    current = typeof current.parentId === "string" ? byId.get(current.parentId) : undefined;
  }
  return records.filter((r) => r.type === "session" || active.has(r as Row));
}

async function legacySessionId(path: string): Promise<string | undefined> {
  // Direct file uploads must use the same identity as the picker. Legacy file
  // headers can retain an older generation's ID after a checkpoint or reset.
  const root = dirname(resolve(path));
  try {
    const index: unknown = JSON.parse(await fs.readFile(join(root, "sessions.json"), "utf8"));
    if (!index || typeof index !== "object" || Array.isArray(index)) return;
    for (const value of Object.values(index)) {
      if (!value || typeof value !== "object" || typeof value.sessionId !== "string") continue;
      const file = typeof value.sessionFile === "string" ? value.sessionFile : `${value.sessionId}.jsonl`;
      if (resolve(root, file) === resolve(path)) return value.sessionId;
    }
  } catch {
    // Standalone exports do not have an index; their header remains authoritative.
  }
}

export async function loadOpenClawSession(
  path: string,
  sessionId?: string,
  onWarning?: Warning,
): Promise<{
  records: OpenClawRecord[];
  sessionId: string;
  cwd: string | null;
}> {
  let records: OpenClawRecord[];
  if (/\.(?:sqlite|db)$/.test(path)) {
    if (!sessionId)
      throw new Error("Select a session ID from the OpenClaw store, rather than uploading the whole database.");
    const db = await openDatabase(path);
    try {
      const windows = db.all("SELECT session_id FROM session_windows WHERE session_id = ?", sessionId);
      if (!windows.length) throw new Error("OpenClaw session no longer exists in this store. Refresh the picker.");
      records = readEvents(db, sessionId, onWarning);
    } finally {
      db.close();
    }
  } else {
    records = selectOpenClawBranch(parseOpenClawRecords(await fs.readFile(path, "utf8"), onWarning));
    sessionId ??= await legacySessionId(path);
  }
  const header = asOpenClawSession(records);
  return { records, sessionId: sessionId ?? header?.id ?? basename(path, ".jsonl"), cwd: header?.cwd ?? null };
}

function metadata(records: OpenClawRecord[], id: string, path: string, updated?: unknown): DiscoveredTranscript {
  const header = asOpenClawSession(records);
  const messages = records.filter((r) => r.type === "message") as Array<{
    message?: { role?: string; content?: unknown };
  }>;
  const text = messages
    .filter((r) => r.message?.role === "user")
    .map((r) => extractOpenClawText(r.message?.content))
    .find(Boolean);
  const parsed = new Date(
    typeof updated === "number" || typeof updated === "string" ? updated : (header?.timestamp ?? 0),
  );
  const preview = text?.replace(/\s+/g, " ").trim();
  return {
    id,
    source: "openclaw",
    path,
    cwd: header?.cwd ?? null,
    timestamp: Number.isNaN(parsed.getTime()) ? new Date(0) : parsed,
    preview: preview ? (preview.length > 80 ? preview.slice(0, 79) + "…" : preview) : null,
    repoId: null,
    stats: null,
  };
}

async function entries(path: string) {
  try {
    return await fs.readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

export async function discoverOpenClawSessions(options?: { limit?: number }): Promise<DiscoveredTranscript[]> {
  const requested = options?.limit ?? 100;
  const limit = Number.isFinite(requested) ? Math.min(Math.floor(requested), 10000) : 100;
  if (limit <= 0) return [];
  const transcripts: DiscoveredTranscript[] = [];
  const candidates: Array<{ path: string; id?: string; mtime: number; indexed: boolean }> = [];
  async function collectJsonl(root: string, indexed: boolean) {
    if (indexed) {
      try {
        const index: unknown = JSON.parse(await fs.readFile(join(root, "sessions.json"), "utf8"));
        if (index && typeof index === "object" && !Array.isArray(index)) {
          for (const value of Object.values(index)) {
            if (!value || typeof value !== "object" || typeof value.sessionId !== "string") continue;
            const path =
              typeof value.sessionFile === "string"
                ? resolve(root, value.sessionFile)
                : join(root, `${value.sessionId}.jsonl`);
            try {
              candidates.push({ path, id: value.sessionId, mtime: (await fs.stat(path)).mtimeMs, indexed: true });
            } catch {
              /* Stale index entry. */
            }
          }
          return;
        }
      } catch {
        /* Older exports may have no session index. */
      }
    }
    for (const entry of await entries(root)) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const path = join(root, entry.name);
      try {
        candidates.push({ path, mtime: (await fs.stat(path)).mtimeMs, indexed: false });
      } catch {
        /* Skip inaccessible files. */
      }
    }
  }
  if (process.env.OPENCLAW_SESSIONS) {
    // Explicit JSONL override is exclusive; do not mix in real device sessions.
    await collectJsonl(resolve(process.env.OPENCLAW_SESSIONS), false);
  } else {
    const state = process.env.OPENCLAW_STATE_DIR ?? join(homedir(), ".openclaw");
    for (const agent of await entries(join(state, "agents"))) {
      if (!agent.isDirectory()) continue;
      const root = join(state, "agents", agent.name);
      const path = join(root, "agent", "openclaw-agent.sqlite");
      let hasStore = false;
      try {
        hasStore = (await fs.stat(path)).isFile();
      } catch {
        /* Pre-v2 agent. */
      }
      if (hasStore) {
        try {
          const db = await openDatabase(path);
          try {
            const nodes = db.all(`SELECT n.current_session_id, w.updated_at FROM session_nodes n
              JOIN session_windows w ON w.session_id = n.current_session_id
              ORDER BY w.updated_at DESC LIMIT ${limit}`);
            for (const node of nodes) {
              if (typeof node.current_session_id !== "string") continue;
              const records = readEvents(db, node.current_session_id, undefined, true);
              transcripts.push(metadata(records, node.current_session_id, path, node.updated_at));
            }
          } finally {
            db.close();
          }
        } catch (error) {
          logger.warn(
            `Could not read OpenClaw sessions for ${agent.name}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        // Never resurrect stale archived JSONL when a v2 store is authoritative.
      } else await collectJsonl(join(root, "sessions"), true);
    }
    await collectJsonl(join(state, "session-backups"), false);
  }
  candidates.sort((a, b) => b.mtime - a.mtime);
  for (const candidate of candidates.slice(0, limit * 2)) {
    try {
      // Picker previews need only a bounded head. Read the complete JSONL and
      // resolve its branch ancestry only after the user selects the session.
      const file = await fs.open(candidate.path, "r");
      let records: OpenClawRecord[];
      try {
        const buffer = Buffer.alloc(Math.min((await file.stat()).size, 256 * 1024));
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        records = parseOpenClawRecords(buffer.subarray(0, bytesRead).toString("utf8"));
      } finally {
        await file.close();
      }
      if (!records.some((r) => r.type === "message")) continue;
      const id = candidate.id ?? asOpenClawSession(records)?.id ?? basename(candidate.path, ".jsonl");
      transcripts.push(metadata(records, id, candidate.path, candidate.indexed ? candidate.mtime : undefined));
    } catch {
      /* Skip invalid or inaccessible exports. */
    }
  }
  // Prefer authoritative live stores over backup copies with the same ID.
  const unique = new Map<string, DiscoveredTranscript>();
  for (const transcript of transcripts) if (!unique.has(transcript.id)) unique.set(transcript.id, transcript);
  return [...unique.values()].sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
}
