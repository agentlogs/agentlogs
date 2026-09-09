import { expect, test } from "@playwright/test";
import { execFileSync } from "child_process";
import { randomUUID } from "crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join, resolve } from "path";
import { eq } from "drizzle-orm";
import { getTestDb } from "../../utils/db";

const root = resolve(import.meta.dirname!, "../../../..");
const secret = "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij";

for (const mode of ["jsonl", "sqlite-id", "sqlite-picker"] as const) {
  test(`OpenClaw ${mode} uploads active history with redaction, attribution and rich edits`, async ({ page }) => {
    const temp = mkdtempSync(join(tmpdir(), "agentlogs-openclaw-e2e-"));
    try {
      const userDir = join(temp, "user");
      const repo = join(temp, "repo");
      const state = join(temp, "openclaw");
      const sessionId = randomUUID();
      const configDir = join(userDir, ".config/agentlogs");
      mkdirSync(configDir, { recursive: true });
      execFileSync("git", ["init", "-b", "openclaw-test", repo], { stdio: "pipe" });
      execFileSync("git", [
        "-C",
        repo,
        "remote",
        "add",
        "origin",
        "https://github.com/agentlogs-test/openclaw-fork.git",
      ]);
      execFileSync("git", ["-C", repo, "remote", "add", "upstream", "https://github.com/agentlogs-test/openclaw.git"]);
      writeFileSync(
        join(configDir, "settings.json"),
        JSON.stringify({
          allowMode: "allowlist",
          repos: { "github.com/agentlogs-test/openclaw": { allow: true, visibility: "private" } },
        }),
      );
      let args: string[];
      if (mode === "jsonl") {
        const path = join(temp, "session.jsonl");
        const text = readFileSync(join(root, "fixtures/openclaw/v2/codex.jsonl"), "utf8")
          .replaceAll("/test/openclaw-project", repo)
          .replace("openclaw-v2-test-session", sessionId);
        // A malformed record should produce a warning and preserve its good neighbors.
        writeFileSync(path, "null\n" + text);
        args = ["openclaw", "upload", path];
      } else {
        execFileSync("bun", [
          join(root, "fixtures/openclaw/v2/store.ts"),
          join(state, "agents/main/agent/openclaw-agent.sqlite"),
          repo,
          sessionId,
        ]);
        args =
          mode === "sqlite-id" ? ["openclaw", "upload", sessionId] : ["upload", "--source", "openclaw", "--latest"];
      }
      const output = execFileSync(
        "bun",
        [join(root, "packages/e2e/utils/openclaw-upload-runner.ts"), JSON.stringify({ userDir, args })],
        {
          cwd: root,
          env: {
            PATH: process.env.PATH,
            NODE_ENV: "test",
            OPENCLAW_STATE_DIR: state,
            AGENTLOGS_AUTH_TOKEN: "test-session-token",
            AGENTLOGS_SERVER_URL: "http://localhost:3009",
          },
          encoding: "utf8",
          timeout: 60000,
        },
      );
      expect(output).toContain("Upload successful!");
      const id = output.match(/Transcript ID: (\w+)/)?.[1];
      expect(id).toBeTruthy();
      const { db, sqlite, schema } = getTestDb();
      try {
        const row = db.select().from(schema.transcripts).where(eq(schema.transcripts.id, id!)).get();
        expect(row).toMatchObject({
          source: "openclaw",
          transcriptId: sessionId,
          userMessageCount: 1,
          toolCount: 4,
          filesChanged: 1,
          linesModified: 1,
          reasoningOutputTokens: 222,
          totalTokens: 187535,
          branch: "openclaw-test",
        });
        const repository = db.select().from(schema.repos).where(eq(schema.repos.id, row!.repoId!)).get();
        expect(repository?.repo).toBe("github.com/agentlogs-test/openclaw");
        expect(row?.preview).toContain("Change beta to gamma");
        expect(row?.preview).not.toContain(secret);
      } finally {
        sqlite.close();
      }
      await page.goto(`/s/${id}`);
      await page.waitForLoadState("networkidle");
      await expect(page.getByText("OPENCLAW_V2_SMOKE_OK", { exact: true })).toBeVisible();
      await expect(page.getByText("gpt-5.6-sol", { exact: true })).toBeVisible();
      await expect(page.getByText(secret, { exact: false })).toHaveCount(0);
      await expect(page.getByText("MUST_NOT_UPLOAD", { exact: false })).toHaveCount(0);
      await page.getByRole("button", { name: /4 steps hidden/ }).click();
      await expect(page.getByText("sample.txt", { exact: false }).first()).toBeVisible();
      await expect(page.getByText("gamma", { exact: true }).first()).toBeVisible();
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  });
}
