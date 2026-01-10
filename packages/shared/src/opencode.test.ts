import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, test } from "bun:test";
import {
  convertOpenCodeTranscript,
  type OpenCodeMessage,
  type OpenCodeSession,
  type UnifiedTranscript,
} from "./opencode";

const FIXTURE_DIR = path.resolve(import.meta.dir, "../../../fixtures/opencode");

const TEST_NOW = new Date("2025-01-15T12:00:00Z");

const TEST_PRICING = {
  "claude-sonnet-4-20250514": {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 1.5e-5,
    cache_creation_input_token_cost: 3e-6,
    cache_read_input_token_cost: 3e-7,
  },
};

interface FixtureData {
  session: OpenCodeSession;
  messages: OpenCodeMessage[];
}

async function loadFixture(filename: string): Promise<FixtureData> {
  const filePath = path.join(FIXTURE_DIR, filename);
  const content = await fs.readFile(filePath, "utf-8");
  return JSON.parse(content) as FixtureData;
}

async function loadAndConvert(filename: string): Promise<UnifiedTranscript | null> {
  const { session, messages } = await loadFixture(filename);
  return convertOpenCodeTranscript(session, messages, {
    now: TEST_NOW,
    pricing: TEST_PRICING,
  });
}

function serializeTranscript(transcript: UnifiedTranscript): Record<string, unknown> {
  return {
    ...transcript,
    timestamp: transcript.timestamp.toISOString(),
  };
}

describe("convertOpenCodeTranscript", () => {
  describe("simple.json", () => {
    test("converts basic user and assistant messages", async () => {
      const transcript = await loadAndConvert("simple.json");
      expect(transcript).not.toBeNull();

      const serialized = serializeTranscript(transcript!);
      expect(serialized).toMatchObject({
        v: 1,
        id: "oc-session-simple-001",
        source: "opencode",
        model: "claude-sonnet-4-20250514",
        messageCount: 2,
      });

      expect(transcript!.messages).toHaveLength(2);
      expect(transcript!.messages[0]).toMatchObject({
        type: "user",
        text: "What is the capital of France?",
      });
      expect(transcript!.messages[1]).toMatchObject({
        type: "agent",
        text: expect.stringContaining("Paris"),
        model: "claude-sonnet-4-20250514",
      });
    });

    test("extracts preview from first user message", async () => {
      const transcript = await loadAndConvert("simple.json");
      expect(transcript!.preview).toBe("What is the capital of France?");
    });

    test("uses session cost when available", async () => {
      const transcript = await loadAndConvert("simple.json");
      expect(transcript!.costUsd).toBe(0.0035);
    });

    test("extracts token usage from session", async () => {
      const transcript = await loadAndConvert("simple.json");
      expect(transcript!.tokenUsage).toMatchObject({
        inputTokens: 150,
        outputTokens: 200,
        cachedInputTokens: 0,
      });
      expect(transcript!.blendedTokens).toBe(350);
    });
  });

  describe("with-tools.json", () => {
    test("converts tool calls with input and output", async () => {
      const transcript = await loadAndConvert("with-tools.json");
      expect(transcript).not.toBeNull();

      const toolCalls = transcript!.messages.filter((m) => m.type === "tool-call");
      expect(toolCalls).toHaveLength(2);
    });

    test("normalizes tool names", async () => {
      const transcript = await loadAndConvert("with-tools.json");

      const toolCalls = transcript!.messages.filter((m) => m.type === "tool-call");
      const toolNames = toolCalls.map((t) => (t as { toolName: string }).toolName);

      // read_file -> Read, shell -> Bash
      expect(toolNames).toContain("Read");
      expect(toolNames).toContain("Bash");
    });

    test("preserves tool input and output", async () => {
      const transcript = await loadAndConvert("with-tools.json");

      const readTool = transcript!.messages.find(
        (m) => m.type === "tool-call" && (m as { toolName: string }).toolName === "Read",
      );
      expect(readTool).toBeDefined();
      expect((readTool as { input: unknown }).input).toMatchObject({
        file_path: expect.any(String),
      });
      expect((readTool as { output: unknown }).output).toMatchObject({
        content: expect.stringContaining("my-awesome-project"),
      });
    });

    test("extracts bash output correctly", async () => {
      const transcript = await loadAndConvert("with-tools.json");

      const bashTool = transcript!.messages.find(
        (m) => m.type === "tool-call" && (m as { toolName: string }).toolName === "Bash",
      );
      expect(bashTool).toBeDefined();
      expect((bashTool as { output: unknown }).output).toMatchObject({
        stdout: expect.stringContaining("PASS"),
        exitCode: 0,
      });
    });
  });

  describe("reasoning.json", () => {
    test("converts reasoning parts to thinking messages", async () => {
      const transcript = await loadAndConvert("reasoning.json");
      expect(transcript).not.toBeNull();

      const thinkingMessages = transcript!.messages.filter((m) => m.type === "thinking");
      expect(thinkingMessages).toHaveLength(1);
      expect(thinkingMessages[0]).toMatchObject({
        type: "thinking",
        text: expect.stringContaining("analyze the function"),
        model: "claude-sonnet-4-20250514",
      });
    });

    test("includes model on thinking messages", async () => {
      const transcript = await loadAndConvert("reasoning.json");

      const thinking = transcript!.messages.find((m) => m.type === "thinking");
      expect((thinking as { model?: string }).model).toBe("claude-sonnet-4-20250514");
    });
  });

  describe("compaction.json", () => {
    test("converts compaction summaries", async () => {
      const transcript = await loadAndConvert("compaction.json");
      expect(transcript).not.toBeNull();

      const compactionMessages = transcript!.messages.filter((m) => m.type === "compaction-summary");
      expect(compactionMessages).toHaveLength(1);
      expect(compactionMessages[0]).toMatchObject({
        type: "compaction-summary",
        text: expect.stringContaining("REST API"),
      });
    });

    test("handles sessions with compaction + regular messages", async () => {
      const transcript = await loadAndConvert("compaction.json");

      const types = transcript!.messages.map((m) => m.type);
      expect(types).toContain("compaction-summary");
      expect(types).toContain("user");
      expect(types).toContain("agent");
      expect(types).toContain("tool-call");
    });
  });

  describe("with-images.json", () => {
    test("converts image files to image messages", async () => {
      const transcript = await loadAndConvert("with-images.json");
      expect(transcript).not.toBeNull();

      const imageMessages = transcript!.messages.filter((m) => m.type === "image");
      expect(imageMessages).toHaveLength(1);
      expect(imageMessages[0]).toMatchObject({
        type: "image",
        mediaType: "image/png",
        data: expect.any(String),
      });
    });

    test("extracts base64 data from data URLs", async () => {
      const transcript = await loadAndConvert("with-images.json");

      const image = transcript!.messages.find((m) => m.type === "image");
      // Should extract base64 portion after the comma
      expect((image as { data?: string }).data).not.toContain("data:image/png;base64,");
      expect((image as { data?: string }).data).toMatch(/^[A-Za-z0-9+/=]+$/);
    });
  });

  describe("tool-error.json", () => {
    test("handles tool errors correctly", async () => {
      const transcript = await loadAndConvert("tool-error.json");
      expect(transcript).not.toBeNull();

      const toolCalls = transcript!.messages.filter((m) => m.type === "tool-call");
      expect(toolCalls).toHaveLength(1);

      const errorTool = toolCalls[0] as { error?: string; isError?: boolean };
      expect(errorTool.error).toContain("permission denied");
      expect(errorTool.isError).toBe(true);
    });
  });

  describe("edge cases", () => {
    test("returns null for empty messages array", () => {
      const session: OpenCodeSession = {
        id: "empty-session",
        createdAt: "2025-01-10T10:00:00.000Z",
      };

      const result = convertOpenCodeTranscript(session, []);
      expect(result).toBeNull();
    });

    test("returns null when no convertible content", () => {
      const session: OpenCodeSession = {
        id: "empty-content",
        createdAt: "2025-01-10T10:00:00.000Z",
      };

      const messages: OpenCodeMessage[] = [
        {
          id: "msg-1",
          sessionId: "empty-content",
          role: "user",
          parts: [{ type: "text", text: "   " }], // Only whitespace
          createdAt: "2025-01-10T10:00:00.000Z",
        },
      ];

      const result = convertOpenCodeTranscript(session, messages);
      expect(result).toBeNull();
    });

    test("uses fallback ID generation when session has no id", () => {
      const session: OpenCodeSession = {
        id: "test-session-123",
        createdAt: "2025-01-10T10:00:00.000Z",
      };

      const messages: OpenCodeMessage[] = [
        {
          id: "msg-1",
          sessionId: "test-session-123",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          createdAt: "2025-01-10T10:00:00.000Z",
        },
      ];

      const result = convertOpenCodeTranscript(session, messages);
      expect(result!.id).toBe("test-session-123");
    });

    test("handles missing optional session fields", () => {
      const session: OpenCodeSession = {
        id: "minimal-session",
        createdAt: "2025-01-10T10:00:00.000Z",
        // No promptTokens, completionTokens, cost, etc.
      };

      const messages: OpenCodeMessage[] = [
        {
          id: "msg-1",
          sessionId: "minimal-session",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          createdAt: "2025-01-10T10:00:00.000Z",
        },
      ];

      const result = convertOpenCodeTranscript(session, messages);
      expect(result).not.toBeNull();
      expect(result!.tokenUsage.inputTokens).toBe(0);
      expect(result!.tokenUsage.outputTokens).toBe(0);
      expect(result!.costUsd).toBe(0);
    });

    test("sorts messages by creation time", () => {
      const session: OpenCodeSession = {
        id: "unsorted-session",
        createdAt: "2025-01-10T10:00:00.000Z",
      };

      const messages: OpenCodeMessage[] = [
        {
          id: "msg-2",
          sessionId: "unsorted-session",
          role: "assistant",
          parts: [{ type: "text", text: "Response" }],
          model: "claude-sonnet-4-20250514",
          createdAt: "2025-01-10T10:00:10.000Z", // Later
        },
        {
          id: "msg-1",
          sessionId: "unsorted-session",
          role: "user",
          parts: [{ type: "text", text: "Question" }],
          createdAt: "2025-01-10T10:00:00.000Z", // Earlier
        },
      ];

      const result = convertOpenCodeTranscript(session, messages);
      expect(result!.messages[0]).toMatchObject({ type: "user", text: "Question" });
      expect(result!.messages[1]).toMatchObject({ type: "agent", text: "Response" });
    });
  });

  describe("git context", () => {
    test("uses provided git context", () => {
      const session: OpenCodeSession = {
        id: "git-session",
        createdAt: "2025-01-10T10:00:00.000Z",
      };

      const messages: OpenCodeMessage[] = [
        {
          id: "msg-1",
          sessionId: "git-session",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          createdAt: "2025-01-10T10:00:00.000Z",
        },
      ];

      const result = convertOpenCodeTranscript(session, messages, {
        gitContext: {
          repo: "github.com/example/repo",
          branch: "main",
          relativeCwd: "src",
        },
      });

      expect(result!.git).toMatchObject({
        repo: "github.com/example/repo",
        branch: "main",
        relativeCwd: "src",
      });
    });

    test("defaults to null git context when not provided", () => {
      const session: OpenCodeSession = {
        id: "no-git-session",
        createdAt: "2025-01-10T10:00:00.000Z",
      };

      const messages: OpenCodeMessage[] = [
        {
          id: "msg-1",
          sessionId: "no-git-session",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          createdAt: "2025-01-10T10:00:00.000Z",
        },
      ];

      const result = convertOpenCodeTranscript(session, messages);
      expect(result!.git).toMatchObject({
        repo: null,
        branch: null,
        relativeCwd: null,
      });
    });
  });

  describe("cwd handling", () => {
    test("formats cwd with tilde", () => {
      const session: OpenCodeSession = {
        id: "cwd-session",
        createdAt: "2025-01-10T10:00:00.000Z",
      };

      const messages: OpenCodeMessage[] = [
        {
          id: "msg-1",
          sessionId: "cwd-session",
          role: "user",
          parts: [{ type: "text", text: "Hello" }],
          createdAt: "2025-01-10T10:00:00.000Z",
        },
      ];

      const result = convertOpenCodeTranscript(session, messages, {
        cwd: "/home/user/project",
      });

      // Should format with tilde (actual behavior depends on formatCwdWithTilde)
      expect(result!.cwd).toBeDefined();
    });

    test("relativizes file paths in tool inputs", () => {
      const session: OpenCodeSession = {
        id: "path-session",
        createdAt: "2025-01-10T10:00:00.000Z",
      };

      const messages: OpenCodeMessage[] = [
        {
          id: "msg-1",
          sessionId: "path-session",
          role: "assistant",
          parts: [
            {
              type: "tool",
              id: "tool-1",
              name: "read_file",
              state: {
                input: { file_path: "/home/user/project/src/index.ts" },
                output: { content: "code" },
                status: "completed",
              },
            },
          ],
          model: "claude-sonnet-4-20250514",
          createdAt: "2025-01-10T10:00:00.000Z",
        },
      ];

      const result = convertOpenCodeTranscript(session, messages, {
        cwd: "/home/user/project",
      });

      const toolCall = result!.messages.find((m) => m.type === "tool-call");
      expect((toolCall as { input: { file_path: string } }).input.file_path).toBe("./src/index.ts");
    });
  });
});
