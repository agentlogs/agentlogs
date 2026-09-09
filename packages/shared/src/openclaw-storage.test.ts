import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { createOpenClawTestStore } from "../../../fixtures/openclaw/v2/store";
import { discoverOpenClawSessions, loadOpenClawSession } from "./openclaw-storage";
import { convertOpenClawTranscript } from "./openclaw";

let state: string;
let previousState: string | undefined;
let previousSessions: string | undefined;
beforeEach(() => {
  previousState = process.env.OPENCLAW_STATE_DIR;
  previousSessions = process.env.OPENCLAW_SESSIONS;
  state = mkdtempSync(join(tmpdir(), "agentlogs-openclaw-store-"));
  process.env.OPENCLAW_STATE_DIR = state;
  delete process.env.OPENCLAW_SESSIONS;
});
afterEach(() => {
  if (previousState === undefined) delete process.env.OPENCLAW_STATE_DIR;
  else process.env.OPENCLAW_STATE_DIR = previousState;
  if (previousSessions === undefined) delete process.env.OPENCLAW_SESSIONS;
  else process.env.OPENCLAW_SESSIONS = previousSessions;
  rmSync(state, { recursive: true, force: true });
});
const header = { type: "session", id: "header-id", cwd: "/test/repo", timestamp: "2026-09-09T10:00:00Z" };
function writeSession(root: string, filename: string, records: unknown[]) {
  mkdirSync(root, { recursive: true });
  const path = join(root, filename);
  writeFileSync(path, records.map((r) => JSON.stringify(r)).join("\n"));
  return path;
}
const user = (id: string, parentId: string | null, content: string) => ({
  type: "message",
  id,
  parentId,
  message: { role: "user", content },
});

describe("OpenClaw storage", () => {
  it("discovers multiple agents and reads only active events with authoritative window identity", async () => {
    const path = join(state, "agents/main/agent/openclaw-agent.sqlite");
    const db = createOpenClawTestStore(path);
    const other = createOpenClawTestStore(
      join(state, "agents/second/agent/openclaw-agent.sqlite"),
      "/second",
      "second-session",
    );
    try {
      const hash = () => createHash("sha256").update(readFileSync(path)).digest("hex");
      const before = hash();
      const sessions = await discoverOpenClawSessions();
      expect(sessions.map((s) => s.id).sort()).toEqual(["openclaw-v2-test-session", "second-session"]);
      expect(sessions[0].preview).toStartWith("Change beta to gamma");
      const selected = await loadOpenClawSession(path, "openclaw-v2-test-session");
      expect(selected.sessionId).toBe("openclaw-v2-test-session");
      const t = convertOpenClawTranscript(selected.records, { sessionId: selected.sessionId });
      expect(t?.id).toBe("openclaw-v2-test-session");
      expect(t?.userMessageCount).toBe(1); // context_eligible=0 remains visible.
      expect(t?.filesChanged).toBe(1);
      expect(JSON.stringify(t)).not.toContain("MUST_NOT_UPLOAD");
      expect(hash()).toBe(before);
      expect((await discoverOpenClawSessions({ limit: 1 })).length).toBe(1);
    } finally {
      db.close();
      other.close();
    }
  });

  it("uses legacy index identity and follows the selected JSONL branch", async () => {
    const root = join(state, "agents/main/sessions");
    const path = writeSession(root, "canonical.jsonl", [
      null,
      header,
      user("a", null, "first"),
      user("b", "a", "abandoned"),
      user("c", "a", "active"),
    ]);
    writeFileSync(join(root, "sessions.json"), JSON.stringify({ main: { sessionId: "canonical", sessionFile: path } }));
    writeSession(root, "old-checkpoint.jsonl", [header, user("x", null, "old checkpoint")]);
    const sessions = await discoverOpenClawSessions();
    expect(sessions.map((s) => s.id)).toEqual(["canonical"]);
    const loaded = await loadOpenClawSession(sessions[0].path, sessions[0].id);
    expect((await loadOpenClawSession(path)).sessionId).toBe("canonical");
    const t = convertOpenClawTranscript(loaded.records, { sessionId: loaded.sessionId });
    expect(t?.id).toBe("canonical");
    expect(t?.messages.map((m) => ("text" in m ? m.text : ""))).toEqual(["first", "active"]);
  });

  it("uses an exclusive JSONL override and tolerates missing or malformed files", async () => {
    expect(await discoverOpenClawSessions()).toEqual([]);
    const root = join(state, "exports");
    writeSession(root, "direct.jsonl", [null, 42, header, user("a", null, "direct")]);
    writeSession(root, "broken.jsonl", [null, []]);
    process.env.OPENCLAW_SESSIONS = root;
    const db = createOpenClawTestStore(join(state, "agents/main/agent/openclaw-agent.sqlite"));
    db.close();
    expect((await discoverOpenClawSessions()).map((s) => s.id)).toEqual(["header-id"]);
    expect(await discoverOpenClawSessions({ limit: 0 })).toEqual([]);
    const warnings: string[] = [];
    const loaded = await loadOpenClawSession(join(root, "direct.jsonl"), undefined, (w) => warnings.push(w));
    expect(loaded.cwd).toBe("/test/repo");
    expect(warnings[0]).toContain("2 malformed");
  });

  it("does not resurrect stale JSONL after a store migration or import a whole database", async () => {
    const path = join(state, "agents/main/agent/openclaw-agent.sqlite");
    const db = createOpenClawTestStore(path);
    db.close();
    writeSession(join(state, "agents/main/sessions"), "stale.jsonl", [header, user("x", null, "stale")]);
    expect((await discoverOpenClawSessions()).map((s) => s.id)).toEqual(["openclaw-v2-test-session"]);
    await expect(loadOpenClawSession(path)).rejects.toThrow("Select a session ID");
    await expect(loadOpenClawSession(path, "missing")).rejects.toThrow("no longer exists");
  });
});
