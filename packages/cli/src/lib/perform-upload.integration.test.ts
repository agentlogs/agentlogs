import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { dirname, join } from "path";
import type { UnifiedTranscript } from "@agentlogs/shared/claudecode";

type Source = "claude-code" | "codex";
type Mode = "single" | "all" | "hook" | "latest" | "sync";
const allowedRepo = "github.com/team/project";
const privateRepo = "github.com/team/private";
const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "agentlogs-upload-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const userDir = join(root, "user");
  const configDir = join(userDir, ".config", "agentlogs");
  mkdirSync(configDir, { recursive: true });
  const settings = (allowMode = "allowlist") =>
    writeFileSync(
      join(configDir, "settings.json"),
      JSON.stringify({
        allowMode,
        repos: { [allowedRepo]: { allow: true, visibility: "team" }, [privateRepo]: { allow: false } },
      }),
    );
  settings();
  function repo(name: string, remotes: Record<string, string>) {
    const path = join(root, name);
    mkdirSync(join(path, ".git"), { recursive: true });
    writeFileSync(join(path, ".git", "HEAD"), "ref: refs/heads/integration\n");
    writeFileSync(
      join(path, ".git", "config"),
      Object.entries(remotes)
        .map(([name, id]) => `[remote "${name}"]\n  url = https://${id}.git\n`)
        .join(""),
    );
    return path;
  }
  const uploads: Array<{ transcript: UnifiedTranscript; visibility: string | null; sha256: string }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/api/transcripts" && request.method === "GET") {
        return Response.json({
          transcripts: uploads.map(({ transcript, sha256 }) => ({
            transcriptId: transcript.id,
            repoId: transcript.git?.repo,
            sha256,
          })),
        });
      }
      if (path !== "/api/ingest" || request.method !== "POST")
        return new Response("Unexpected request", { status: 404 });
      const data = await request.formData();
      const transcript = JSON.parse(String(data.get("unifiedTranscript"))) as UnifiedTranscript;
      uploads.push({
        transcript,
        visibility: data.has("visibility") ? String(data.get("visibility")) : null,
        sha256: String(data.get("sha256")),
      });
      return Response.json({ success: true, id: String(data.get("id")), transcriptId: transcript.id });
    },
  });
  cleanups.push(() => server.stop(true));
  async function run(source: Source, mode: Mode, cwds: string[], hint = cwds[0], repoFilter?: string) {
    const sessionId = "00000000-0000-4000-8000-000000000043";
    const timestamp = "2026-09-09T10:00:00.000Z";
    const transcriptPath =
      source === "claude-code"
        ? join(userDir, ".claude", "projects", "integration", `${sessionId}.jsonl`)
        : join(userDir, ".codex", "sessions", "2026", "09", "09", `rollout-${sessionId}.jsonl`);
    mkdirSync(dirname(transcriptPath), { recursive: true });
    const records =
      source === "claude-code"
        ? cwds.map((cwd, index) => ({
            type: "user",
            uuid: `message-${index}`,
            sessionId,
            timestamp,
            cwd,
            gitBranch: index === 0 ? "starting-directory-branch" : undefined,
            message: { role: "user", content: `Check directory ${index}` },
          }))
        : [
            {
              type: "session_meta",
              timestamp,
              payload: { id: sessionId, cwd: cwds[0], timestamp, cli_version: "0.89.0" },
            },
            ...cwds.slice(1).map((cwd) => ({ type: "turn_context", timestamp, payload: { cwd } })),
            { type: "event_msg", timestamp, payload: { type: "user_message", message: "Check these directories" } },
            {
              type: "response_item",
              timestamp,
              payload: {
                type: "message",
                role: "user",
                content: [{ type: "input_text", text: "Check these directories" }],
              },
            },
          ];
    writeFileSync(transcriptPath, records.map((record) => JSON.stringify(record)).join("\n"));
    const child = Bun.spawn(
      [
        process.execPath,
        join(import.meta.dir, "fixtures", "upload-runner.ts"),
        JSON.stringify({
          userDir,
          mode,
          source,
          transcriptPath,
          sessionId,
          cwd: hint,
          repoFilter,
        }),
      ],
      {
        cwd: root,
        env: {
          PATH: process.env.PATH,
          AGENTLOGS_SERVER_URL: server.url.origin,
          AGENTLOGS_AUTH_TOKEN: "integration-test",
        },
        stdin: new Blob([
          JSON.stringify({
            hook_event_name: "Stop",
            session_id: sessionId,
            transcript_path: transcriptPath,
            cwd: hint,
          }),
        ]),
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
    return stdout;
  }
  return { root, userDir, settings, repo, uploads, run };
}

describe("upload permission and attribution through command entry points", () => {
  for (const source of ["claude-code", "codex"] as const) {
    for (const mode of ["single", "all", "hook", "latest"] as const) {
      test(`${source} ${mode}: home-to-clone uploads to the allowed upstream`, async () => {
        const f = fixture();
        const clone = f.repo("fork", { origin: "github.com/person/fork", upstream: allowedRepo });
        await f.run(source, mode, [f.userDir, clone, clone], f.userDir);
        expect(f.uploads).toHaveLength(1);
        expect(f.uploads[0].transcript.git).toMatchObject({ repo: allowedRepo, branch: "integration" });
        expect(f.uploads[0].visibility).toBe("team");
      });
      test(`${source} ${mode}: a hint cannot hide a denied second root`, async () => {
        const f = fixture();
        f.settings("denylist");
        const allowed = f.repo("allowed", { origin: allowedRepo });
        const denied = f.repo("private", { origin: privateRepo });
        const output = await f.run(source, mode, [allowed, denied], allowed);
        expect(f.uploads).toHaveLength(0);
        if (mode === "latest") expect(output).toContain("explicitly denied repository");
      });
    }
    test(`${source}: an unresolved root cannot ride along with an allowed one`, async () => {
      const f = fixture();
      const allowed = f.repo("allowed", { origin: allowedRepo });
      const unknown = f.repo("no-remote", {});
      const output = await f.run(source, "all", [allowed, unknown], allowed);
      expect(f.uploads).toHaveLength(0);
      expect(JSON.parse(output).skipReason.reason).toBe("unresolved-root");
    });
    test(`${source}: an additional hook directory is permission-checked`, async () => {
      const f = fixture();
      const allowed = f.repo("allowed", { origin: allowedRepo });
      const denied = f.repo("private", { origin: privateRepo });
      await f.run(source, "hook", [allowed], denied);
      expect(f.uploads).toHaveLength(0);
    });
  }
  test("sync filters by selected upstream and does not re-upload unchanged data", async () => {
    const f = fixture();
    const clone = f.repo("fork", { origin: "github.com/person/fork", upstream: allowedRepo });
    const cwds = [f.userDir, clone, clone];
    const first = await f.run("claude-code", "sync", cwds, f.userDir, allowedRepo);
    expect(first).toContain("1 uploaded");
    expect(f.uploads).toHaveLength(1);
    expect(f.uploads[0].transcript.git?.repo).toBe(allowedRepo);
    const second = await f.run("claude-code", "sync", cwds, f.userDir, allowedRepo);
    expect(second).toContain("All local transcripts are up to date.");
    expect(f.uploads).toHaveLength(1);
  });
  test("sync excludes mixed allowed and unlisted roots before upload", async () => {
    const f = fixture();
    const allowed = f.repo("allowed", { origin: allowedRepo });
    const unlisted = f.repo("private", { origin: privateRepo });
    const output = await f.run("claude-code", "sync", [allowed, unlisted]);
    expect(output).toContain("no allowlisted remote");
    expect(f.uploads).toHaveLength(0);
  });
  test("a real linked Git worktree uploads using the shared upstream and its own branch", async () => {
    const f = fixture();
    const clone = join(f.root, "clone");
    const worktree = join(f.root, "worktree");
    function git(args: string[]) {
      const result = Bun.spawnSync(["git", "-c", "core.fsmonitor=false", "-c", "commit.gpgsign=false", ...args], {
        cwd: f.root,
      });
      expect({ code: result.exitCode, stderr: result.stderr.toString() }).toMatchObject({ code: 0 });
    }
    git(["init", "-b", "main", clone]);
    git([
      "-C",
      clone,
      "-c",
      "user.name=Upload test",
      "-c",
      "user.email=upload@example.test",
      "commit",
      "--allow-empty",
      "-m",
      "Initial fixture",
    ]);
    git(["-C", clone, "remote", "add", "origin", "https://github.com/person/fork.git"]);
    git(["-C", clone, "remote", "add", "upstream", `https://${allowedRepo}.git`]);
    git(["-C", clone, "worktree", "add", "-b", "feature/integration", worktree]);
    await f.run("codex", "latest", [f.userDir, worktree, worktree], f.userDir);
    expect(f.uploads).toHaveLength(1);
    expect(f.uploads[0].transcript.git).toMatchObject({ repo: allowedRepo, branch: "feature/integration" });
  });
});
