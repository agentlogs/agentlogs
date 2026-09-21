import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import { convertOpenCodeTranscript, mapOpenCodeV2Export, type OpenCodeV2Export } from "./opencode";
import { formatCwdWithTilde } from "./paths";

const FIXTURE_DIR = path.resolve(import.meta.dir, "../../../fixtures/opencode");

const TEST_GIT_CONTEXT = {
  repo: "github.com/agentlogs/agentlogs",
  branch: "main",
  relativeCwd: null,
};

async function loadV2Fixture(filename: string): Promise<OpenCodeV2Export> {
  const content = await fs.readFile(path.join(FIXTURE_DIR, filename), "utf-8");
  return JSON.parse(content) as OpenCodeV2Export;
}

describe("mapOpenCodeV2Export", () => {
  test("normalizes info and keeps user/assistant messages", async () => {
    const data = await loadV2Fixture("v2-export.json");
    const mapped = mapOpenCodeV2Export(data);

    expect(mapped.info).toEqual({
      id: "ses_v2fixture0000000000000001",
      title: "Migrate the agentlogs plugin to OpenCode 2",
      directory: "/home/dev/agentlogs",
      time: { created: 1789948117000, updated: 1789948122000 },
    });
    expect(mapped.messages).toHaveLength(3);

    // Only user + assistant messages survive; synthetic/control are dropped.
    expect(mapped.messages.map((m) => m.info.role)).toEqual(["user", "assistant", "assistant"]);
    expect(mapped.messages[0].info.role).toBe("user");
    expect(mapped.messages[0].parts).toEqual([
      { type: "text", text: "Migrate the agentlogs opencode plugin so it loads under OpenCode 2." },
    ]);
  });

  test("maps assistant model, tokens, cost, and finish", async () => {
    const data = await loadV2Fixture("v2-export.json");
    const mapped = mapOpenCodeV2Export(data);

    const [assistant, second] = mapped.messages.slice(1);
    expect(assistant.info.modelID).toBe("deepseek-v4-flash");
    expect(assistant.info.providerID).toBe("opencode");
    expect(assistant.info.model).toEqual({ providerID: "opencode", modelID: "deepseek-v4-flash" });
    expect(assistant.info.cost).toBe(0.00123);
    expect(assistant.info.finish).toBe("tool-calls");
    expect(assistant.info.tokens).toEqual({
      input: 8421,
      output: 310,
      reasoning: 44,
      cache: { read: 2048, write: 0 },
    });
    expect(second.info.tokens?.cache).toEqual({ read: 2048, write: 0 });
  });

  test("maps tool parts with content, bash output mirroring, and errors", async () => {
    const data = await loadV2Fixture("v2-export.json");
    const mapped = mapOpenCodeV2Export(data);

    const assistant = mapped.messages[1];
    const parts = assistant.parts.filter((p) => p.type === "tool") as Extract<
      (typeof assistant.parts)[number],
      { type: "tool" }
    >[];
    expect(parts).toHaveLength(3);
    expect(parts.map((p) => p.tool)).toEqual(["read", "shell", "grep"]);

    // Read: text content becomes output
    const read = parts[0];
    expect(read.state?.output).toContain("Read directory /home/dev/agentlogs");

    // Shell: content is mirrored into metadata.output for the Bash sanitizer
    const shell = parts[1];
    expect(shell.state?.status).toBe("completed");
    expect(shell.state?.input).toEqual({ command: "cd /home/dev/agentlogs && git status" });
    expect(shell.state?.output).toContain("On branch main");
    expect(shell.state?.metadata?.output).toContain("nothing to commit, working tree clean");
    expect(shell.state?.metadata?.exit).toBe(0);

    // Grep: structured error becomes a string error
    const grep = parts[2];
    expect(grep.state?.status).toBe("error");
    expect(grep.state?.error).toBe("No matches found");
  });

  test("converts end-to-end through convertOpenCodeTranscript", async () => {
    const data = await loadV2Fixture("v2-export.json");
    const mapped = mapOpenCodeV2Export(data);

    const transcript = convertOpenCodeTranscript(mapped, {
      gitContext: TEST_GIT_CONTEXT,
      cwd: "/home/dev/agentlogs",
    });

    expect(transcript).not.toBeNull();
    expect(transcript!.source).toBe("opencode");
    expect(transcript!.id).toBe("ses_v2fixture0000000000000001");
    expect(transcript!.summary).toBe("Migrate the agentlogs plugin to OpenCode 2");
    expect(transcript!.preview).toBe("Migrate the agentlogs opencode plugin so it loads under OpenCode 2.");
    expect(transcript!.model).toBe("opencode/deepseek-v4-flash");
    expect(transcript!.cwd).toBe(formatCwdWithTilde("/home/dev/agentlogs"));

    const messages = transcript!.messages;
    const userCount = messages.filter((m) => m.type === "user").length;
    const toolCalls = messages.filter((m) => m.type === "tool-call");
    expect(userCount).toBe(1);
    expect(toolCalls.map((m) => m.toolName)).toEqual(["Read", "Bash", "Grep"]);

    // Bash output comes through the sanitizer via metadata.output
    const bash = toolCalls.find((m) => m.toolName === "Bash");
    expect(bash?.output).toMatchObject({
      stdout: expect.stringContaining("nothing to commit"),
      exitCode: 0,
    });

    // Failed grep is flagged as an error
    const grep = toolCalls.find((m) => m.toolName === "Grep");
    expect(grep?.isError).toBe(true);
    expect(grep?.error).toBe("No matches found");
  });
});
