import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync } from "fs";
import { dirname, join } from "path";

/** Synthetic schema-19 store with active, abandoned, and reset history. */
export function createOpenClawTestStore(
  path: string,
  cwd = "/test/openclaw-project",
  sessionId = "openclaw-v2-test-session",
) {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA user_version = 19;
    CREATE TABLE session_nodes (session_key TEXT PRIMARY KEY, current_session_id TEXT);
    CREATE TABLE session_windows (session_id TEXT PRIMARY KEY, session_key TEXT, updated_at INTEGER);
    CREATE TABLE transcript_events (session_id TEXT, seq INTEGER, event_json TEXT, created_at INTEGER, PRIMARY KEY(session_id, seq));
    CREATE TABLE session_transcript_active_events (session_id TEXT, active_position INTEGER, event_seq INTEGER, message_position INTEGER, context_eligible INTEGER);
  `);
  db.run("INSERT INTO session_nodes VALUES (?, ?)", ["agent:main:main", sessionId]);
  db.run("INSERT INTO session_windows VALUES (?, ?, ?)", [sessionId, "agent:main:main", 1788948000000]);
  db.run("INSERT INTO session_windows VALUES (?, ?, ?)", ["before-reset", "agent:main:main", 1788940000000]);
  const fixture = readFileSync(join(import.meta.dir, "codex.jsonl"), "utf8").replaceAll("/test/openclaw-project", cwd);
  const records = fixture
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  records[0].id = "old-header-id"; // Store identity, not this stale header ID, wins.
  records.forEach((record, seq) => {
    db.run("INSERT INTO transcript_events VALUES (?, ?, ?, ?)", [sessionId, seq, JSON.stringify(record), seq]);
    if (seq > 0)
      db.run("INSERT INTO session_transcript_active_events VALUES (?, ?, ?, ?, ?)", [
        sessionId,
        seq - 1,
        seq,
        seq - 1,
        seq === 1 ? 0 : 1,
      ]);
  });
  db.run("INSERT INTO transcript_events VALUES (?, ?, ?, ?)", [
    sessionId,
    100,
    JSON.stringify({ type: "message", message: { role: "user", content: "ABANDONED_BRANCH_MUST_NOT_UPLOAD" } }),
    100,
  ]);
  db.run("INSERT INTO transcript_events VALUES (?, ?, ?, ?)", [
    "before-reset",
    1,
    JSON.stringify({ type: "message", message: { role: "user", content: "OLD_RESET_MUST_NOT_UPLOAD" } }),
    1,
  ]);
  // Leave the connection open so tests also exercise reading a live WAL.
  return db;
}

if (import.meta.main) {
  const [path, cwd, sessionId] = process.argv.slice(2);
  if (!path) throw new Error("Expected synthetic database path");
  createOpenClawTestStore(path, cwd, sessionId).close();
}
