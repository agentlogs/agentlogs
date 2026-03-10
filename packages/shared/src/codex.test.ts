import path from "node:path";
import { describe, expect, test } from "bun:test";
import type { ConversionResult } from "./claudecode";
import { convertCodexFile, convertCodexTranscript } from "./codex";
import { formatCwdWithTilde } from "./paths";
import type { LiteLLMModelPricing } from "./pricing";

const FIXTURE_DIR = path.resolve(import.meta.dir, "../../../fixtures/codex");
const TEST_NOW = new Date("2026-01-25T12:00:00Z");
const TEST_PRICING: Record<string, LiteLLMModelPricing> = {
  "gpt-5-codex": {
    cache_read_input_token_cost: 1.25e-7,
    input_cost_per_token: 0.00000125,
    output_cost_per_token: 0.00001,
  },
  "gpt-5.2-codex": {
    cache_read_input_token_cost: 1.25e-7,
    input_cost_per_token: 0.00000125,
    output_cost_per_token: 0.00001,
  },
};

describe("convertCodexFile", () => {
  test("crud.jsonl", async () => {
    const serialized = await loadSerializedTranscript("crud.jsonl");
    expect(serialized.transcript.cwd).toBe(formatCwdWithTilde("/Users/philipp/dev/agentlogs/fixtures"));
    expect(serialized).toMatchInlineSnapshot(`
      {
        "blobs": {
          "count": 0,
          "sha256s": [],
        },
        "transcript": {
          "blendedTokens": 6691,
          "clientVersion": "0.89.0",
          "costUsd": 0.0243885,
          "cwd": "~/dev/agentlogs/fixtures",
          "filesChanged": 1,
          "git": {
            "branch": "main",
            "relativeCwd": "fixtures",
            "repo": "github.com/agentlogs/agentlogs",
          },
          "id": "019bf4b5-e7b0-75a0-8bf2-05fbf1b13c9b",
          "linesAdded": 7,
          "linesModified": 1,
          "linesRemoved": 0,
          "messageCount": 9,
          "messages": [
            {
              "text": "create a file \`JOKE.md\` with a random joke with a title and a footer with some random text, then read this file, then make change to the file, then delete the file.",
              "timestamp": "2026-01-25T10:32:00.708Z",
              "type": "user",
            },
            {
              "model": "openai/gpt-5.2-codex",
              "text": "**Planning file operations and command sequence**",
              "timestamp": "2026-01-25T10:32:03.661Z",
              "type": "thinking",
            },
            {
              "id": "call_3LP2FP4eeep7JxJRvO3h42Oh",
              "input": {
                "content": 
      "# The Late Comedian

      Why did the scarecrow get promoted? Because he was outstanding in his field.

      ---
      Footer note: The coffee machine approves this message.
      "
      ,
                "file_path": "./JOKE.md",
              },
              "model": "openai/gpt-5.2-codex",
              "output": undefined,
              "timestamp": "2026-01-25T10:32:04.513Z",
              "toolName": "Write",
              "type": "tool-call",
            },
            {
              "id": "call_Cxwk4ioosZkYyeToIOOH3NB6",
              "input": {
                "file_path": "./JOKE.md",
              },
              "model": "openai/gpt-5.2-codex",
              "output": 
      "# The Late Comedian

      Why did the scarecrow get promoted? Because he was outstanding in his field.

      ---
      Footer note: The coffee machine approves this message."
      ,
              "timestamp": "2026-01-25T10:32:06.455Z",
              "toolName": "Read",
              "type": "tool-call",
            },
            {
              "model": "openai/gpt-5.2-codex",
              "text": "**Modifying footer text**",
              "timestamp": "2026-01-25T10:32:07.754Z",
              "type": "thinking",
            },
            {
              "id": "call_jNxPfZXnxjqCPQxUeOy07aR1",
              "input": {
                "diff": 
      "@@
      -Footer note: The coffee machine approves this message.
      +Footer note: The office cactus applauds politely.
      "
      ,
                "file_path": "./JOKE.md",
              },
              "model": "openai/gpt-5.2-codex",
              "output": {
                "exitCode": 0,
                "message": 
      "Success. Updated the following files:
      M ./JOKE.md"
      ,
              },
              "timestamp": "2026-01-25T10:32:08.476Z",
              "toolName": "Edit",
              "type": "tool-call",
            },
            {
              "model": "openai/gpt-5.2-codex",
              "text": "**Deleting file**",
              "timestamp": "2026-01-25T10:32:10.017Z",
              "type": "thinking",
            },
            {
              "id": "call_p5WYLDqEH0nELpogFOahfsv4",
              "input": {
                "command": "rm ./JOKE.md",
              },
              "model": "openai/gpt-5.2-codex",
              "output": {
                "durationSeconds": 0.0522,
                "exitCode": 0,
              },
              "timestamp": "2026-01-25T10:32:10.281Z",
              "toolName": "Bash",
              "type": "tool-call",
            },
            {
              "model": "openai/gpt-5.2-codex",
              "text": "Created \`JOKE.md\`, read it, updated the footer line, and deleted the file.",
              "timestamp": "2026-01-25T10:32:11.486Z",
              "type": "agent",
            },
          ],
          "model": "openai/gpt-5.2-codex",
          "modelUsage": [
            {
              "model": "openai/gpt-5.2-codex",
              "usage": {
                "cachedInputTokens": 78848,
                "inputTokens": 84834,
                "outputTokens": 577,
                "reasoningOutputTokens": 128,
                "totalTokens": 85411,
              },
            },
          ],
          "preview": "create a file \`JOKE.md\` with a random joke with a title and a footer with some random text, then read this file, then make change to the file, then delete the file.",
          "source": "codex",
          "summary": null,
          "timestamp": "2026-01-25T10:32:11.490Z",
          "tokenUsage": {
            "cachedInputTokens": 78848,
            "inputTokens": 84834,
            "outputTokens": 577,
            "reasoningOutputTokens": 128,
            "totalTokens": 85411,
          },
          "toolCount": 4,
          "userMessageCount": 1,
          "v": 1,
        },
      }
      `);
  });

  test("rejects unsafe data URL media types for images", () => {
    const safePng = "iVBORw0KGgo=";
    const unsafeHtml = Buffer.from("<script>alert(1)</script>").toString("base64");

    const transcript = convertCodexTranscript([
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [
            { type: "input_image", image_url: `data:image/png;base64,${safePng}` },
            { type: "input_image", image_url: `data:text/html;base64,${unsafeHtml}` },
            { type: "input_image", image_url: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" },
          ],
        },
      },
    ]);

    expect(transcript).toBeTruthy();
    expect(transcript?.blobs.size).toBe(1);

    const firstMessage = transcript?.transcript.messages[0];
    expect(firstMessage?.type).toBe("user");
    expect((firstMessage as { images?: Array<{ mediaType: string }> }).images).toEqual([
      expect.objectContaining({ mediaType: "image/png" }),
    ]);
  });

  test("images.jsonl", async () => {
    const serialized = await loadSerializedTranscript("images.jsonl");

    expect(serialized.blobs.count).toBe(1);
    expect(serialized.blobs.sha256s[0]).toMatch(/^[a-f0-9]{64}$/);

    const isUserWithImages = (
      message: (typeof serialized.transcript.messages)[number],
    ): message is Extract<(typeof serialized.transcript.messages)[number], { type: "user" }> & {
      images: Array<{ sha256: string; mediaType: string }>;
    } => message.type === "user" && Array.isArray(message.images) && message.images.length > 0;

    const userWithImage = serialized.transcript.messages.find(isUserWithImages);
    expect(userWithImage).toBeTruthy();
    expect(userWithImage?.images).toEqual([{ sha256: serialized.blobs.sha256s[0], mediaType: "image/png" }]);
    expect(userWithImage?.text).not.toContain("[Image");
    expect(userWithImage?.text).not.toContain("<image");
    expect(userWithImage?.text).not.toContain("</image>");

    const grepCall = serialized.transcript.messages.find(
      (message) => message.type === "tool-call" && message.toolName === "Grep",
    );
    expect(grepCall).toBeTruthy();
    expect((grepCall as { input?: Record<string, unknown> }).input?.pattern).toBe(
      "Agent Usage|Claude Code|Codex CLI|OpenCode",
    );

    const readWithRange = serialized.transcript.messages.find((message) => {
      if (message.type !== "tool-call" || message.toolName !== "Read") {
        return false;
      }
      const output = message.output as Record<string, unknown> | undefined;
      const file = output?.file as Record<string, unknown> | undefined;
      return typeof file?.startLine === "number" && file.startLine > 1;
    });
    expect(readWithRange).toBeTruthy();
  });
});

async function loadSerializedTranscript(fileName: string) {
  const transcript = await convertCodexFile(path.join(FIXTURE_DIR, fileName), {
    now: TEST_NOW,
    pricing: TEST_PRICING,
  });

  expect(transcript).not.toBeNull();
  return serializeResult(transcript!);
}

function serializeResult(result: ConversionResult) {
  return {
    transcript: {
      ...result.transcript,
      timestamp: result.transcript.timestamp.toISOString(),
    },
    blobs: {
      count: result.blobs.size,
      sha256s: [...result.blobs.keys()].sort(),
    },
  };
}
