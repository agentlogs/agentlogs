import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { convertOpenClawTranscript, parseOpenClawRecords, type OpenClawRecord } from "./openclaw";
import { discoverOpenClawSessions } from "./discovery";
import type { UnifiedGitContext } from "./claudecode";

const FIXTURES = resolve(import.meta.dir, "../../../fixtures/openclaw");
const TEST_GIT_CONTEXT: UnifiedGitContext = { repo: "github.com/acme/repo", branch: "main", relativeCwd: null };

function loadFixture(name: string): OpenClawRecord[] {
  return readFileSync(resolve(FIXTURES, name), "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as OpenClawRecord);
}

function convert(name: string) {
  const transcript = convertOpenClawTranscript(loadFixture(name), { gitContext: TEST_GIT_CONTEXT });
  if (!transcript) throw new Error("conversion returned null");
  return transcript;
}

describe("convertOpenClawTranscript", () => {
  it("converts a basic session into a schema-valid openclaw transcript", () => {
    const t = convert("crud.jsonl");
    expect(t.source).toBe("openclaw");
    expect(t.id).toBe("11111111-1111-4111-8111-111111111111");
    expect(t.model).toBe("claude-opus-4-5");
    expect(t.cwd).toBe("~/project"); // formatCwdWithTilde collapses /Users/<user> to ~
    expect(t.git?.repo).toBe("github.com/acme/repo");

    const types = t.messages.map((m) => m.type);
    expect(types).toEqual(["user", "thinking", "agent", "tool-call", "agent", "compaction-summary"]);
  });

  it("links a toolResult to its originating tool-call and shapes Bash output", () => {
    const t = convert("crud.jsonl");
    const toolCall = t.messages.find((m) => m.type === "tool-call");
    expect(toolCall).toBeDefined();
    // @ts-expect-error narrowed at runtime
    expect(toolCall.toolName).toBe("Bash");
    // @ts-expect-error narrowed at runtime
    expect(toolCall.output).toEqual({ stdout: "README.md\nsrc" });
  });

  it("aggregates token usage and cost from assistant messages", () => {
    const t = convert("crud.jsonl");
    expect(t.tokenUsage.inputTokens).toBe(220); // 100 + 120
    expect(t.tokenUsage.outputTokens).toBe(70); // 50 + 20
    expect(t.tokenUsage.cachedInputTokens).toBe(15); // 10 + 5
    expect(t.costUsd).toBeCloseTo(0.004, 6); // 0.003 + 0.001
    expect(t.blendedTokens).toBe(290);
  });

  it("maps the compaction record to a compaction-summary message", () => {
    const t = convert("crud.jsonl");
    const compaction = t.messages.find((m) => m.type === "compaction-summary");
    expect(compaction).toBeDefined();
    // @ts-expect-error narrowed at runtime
    expect(compaction.text).toContain("README is present");
  });

  it("maps read/write/bash to canonical tools and passes unknown tools through", () => {
    const t = convert("all-tools.jsonl");
    const tools = t.messages.filter((m) => m.type === "tool-call") as Array<{
      toolName: string;
      input?: unknown;
      output?: unknown;
      isError?: boolean | string;
    }>;
    const byName = Object.fromEntries(tools.map((tc) => [tc.toolName, tc]));

    expect(Object.keys(byName).sort()).toEqual(["Bash", "Browser", "Read", "Write"]);

    // Read maps path -> file_path and shapes output as { file: { content, numLines } }.
    expect(byName.Read.input).toEqual({ file_path: "/Users/dev/project/README.md" });
    expect(byName.Read.output).toMatchObject({ file: { content: "# Title\nbody line", numLines: 2 } });

    // Write keeps file_path + content; Bash keeps command + stdout output.
    expect(byName.Write.input).toEqual({ file_path: "/Users/dev/project/out.txt", content: "hello" });
    expect(byName.Bash.output).toEqual({ stdout: "hi" });

    // Browser has no canonical mapping: name capitalized, raw text output, error flag preserved.
    expect(byName.Browser.output).toBe("navigation failed");
    expect(byName.Browser.isError).toBe(true);
  });

  it("returns null for an empty record list", () => {
    expect(convertOpenClawTranscript([])).toBeNull();
  });

  it("propagates isError onto a matched (non-orphan) tool-call", () => {
    const records = [
      { type: "session", id: "s", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/x" },
      {
        type: "message",
        message: {
          role: "assistant",
          model: "m",
          content: [{ type: "toolCall", id: "b1", name: "bash", arguments: { command: "false" } }],
        },
      },
      {
        type: "message",
        message: { role: "toolResult", toolCallId: "b1", content: [{ type: "text", text: "boom" }], isError: true },
      },
    ] as unknown as OpenClawRecord[];
    const t = convertOpenClawTranscript(records, { gitContext: TEST_GIT_CONTEXT });
    const call = t?.messages.find((m) => m.type === "tool-call") as { isError?: boolean | string } | undefined;
    expect(call?.isError).toBe(true);
  });
});

describe("convertOpenClawTranscript robustness", () => {
  it("does not throw on malformed records and skips the bad ones", () => {
    const records = [
      null,
      { type: "session", id: "s", timestamp: "not-a-real-date", cwd: "/x" },
      { type: "message", message: { role: "user", content: "not-an-array" } },
      { type: "message", message: null },
      {
        type: "message",
        message: {
          role: "assistant",
          content: [null, 7, { type: "text", text: "kept" }, { type: "toolCall", id: "t" }],
        },
      },
      { type: "some-future-record-type", foo: 1 },
    ] as unknown as OpenClawRecord[];

    const t = convertOpenClawTranscript(records, { gitContext: TEST_GIT_CONTEXT });
    expect(t).not.toBeNull();
    // Invalid timestamp degrades to a valid Date rather than throwing in z.coerce.date().
    expect(t?.timestamp instanceof Date).toBe(true);
    expect(Number.isNaN(t!.timestamp.getTime())).toBe(false);
    // The one good assistant text block survived; the toolCall with no name still mapped.
    expect(t?.messages.some((m) => m.type === "agent" && (m as { text?: string }).text === "kept")).toBe(true);
  });

  it("skips messages that fail schema validation instead of aborting the whole transcript", () => {
    // A future content type the schema doesn't know about should not nuke the session.
    const records = [
      { type: "session", id: "s", timestamp: "2026-01-01T00:00:00.000Z", cwd: "/x" },
      { type: "message", message: { role: "user", content: [{ type: "text", text: "hello" }] } },
    ] as unknown as OpenClawRecord[];
    const t = convertOpenClawTranscript(records, { gitContext: TEST_GIT_CONTEXT });
    expect(t?.messages.some((m) => m.type === "user")).toBe(true);
  });
});

describe("parseOpenClawRecords", () => {
  it("skips malformed JSONL lines", () => {
    const content = ['{"type":"session","id":"s"}', "not json {{{", "", '{"type":"message"}'].join("\n");
    const records = parseOpenClawRecords(content);
    expect(records.length).toBe(2);
    expect((records[0] as { id?: string }).id).toBe("s");
  });
});

describe("discoverOpenClawSessions", () => {
  it("finds sessions in OPENCLAW_SESSIONS, newest first, with id/cwd/preview", async () => {
    const prev = process.env.OPENCLAW_SESSIONS;
    process.env.OPENCLAW_SESSIONS = FIXTURES;
    try {
      const sessions = await discoverOpenClawSessions();
      expect(sessions.length).toBe(2);
      expect(sessions.every((s) => s.source === "openclaw")).toBe(true);
      // Sorted by timestamp descending (all-tools is 02:00, crud is 01:00).
      expect(sessions[0]?.id).toBe("22222222-2222-4222-8222-222222222222");
      expect(sessions[1]?.id).toBe("11111111-1111-4111-8111-111111111111");
      expect(sessions[1]?.preview).toBe("List the files and read the README");
      expect(sessions[1]?.cwd).toBe("/Users/dev/project");
    } finally {
      if (prev === undefined) delete process.env.OPENCLAW_SESSIONS;
      else process.env.OPENCLAW_SESSIONS = prev;
    }
  });
});
