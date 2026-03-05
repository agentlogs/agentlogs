import { describe, expect, test } from "bun:test";
import { convertClaudeCodeTranscript } from "./claudecode";

/**
 * Helper to create a minimal transcript from tool_use and tool_result objects
 * and extract the tool call message
 */
function processToolCall(toolUse: any, toolResult: any) {
  const cwd = "/Users/philipp/dev/vibeinsights";

  // Wrap in minimal transcript envelope
  const assistantMessage = {
    type: "assistant",
    uuid: "test-assistant-uuid",
    parentUuid: null,
    timestamp: "2025-10-12T21:36:00.000Z",
    cwd,
    message: {
      model: "claude-sonnet-4-5-20250929",
      id: toolUse.id || "test-msg-id",
      role: "assistant",
      content: [toolUse],
    },
  };

  const userMessage = {
    type: "user",
    uuid: "test-user-uuid",
    parentUuid: "test-assistant-uuid",
    timestamp: "2025-10-12T21:36:01.000Z",
    cwd,
    message: {
      role: "user",
      content: [toolResult],
    },
    toolUseResult: toolResult.output,
  };

  const transcript = [assistantMessage, userMessage];
  const converted = convertClaudeCodeTranscript(transcript);
  return converted?.transcript.messages.find((m) => m.type === "tool-call");
}

describe("Tool Call Input/Output Processing", () => {
  test("Write tool", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01QJVoGNGRGH9v9TNN9LQzK9",
      name: "Write",
      input: {
        file_path: "/Users/philipp/dev/vibeinsights/fixtures/claudecode/JOKE.md",
        content:
          "# Why Don't Programmers Like Nature?\n\nBecause it has too many bugs!\n\n---\n\n*This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*\n",
      },
    };

    const toolResult = {
      tool_use_id: "toolu_01QJVoGNGRGH9v9TNN9LQzK9",
      type: "tool_result",
      content: "File created successfully at: /Users/philipp/dev/vibeinsights/fixtures/claudecode/JOKE.md",
      output: {
        type: "create",
        filePath: "/Users/philipp/dev/vibeinsights/fixtures/claudecode/JOKE.md",
        content:
          "# Why Don't Programmers Like Nature?\n\nBecause it has too many bugs!\n\n---\n\n*This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*\n",
        structuredPatch: [],
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);
    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01QJVoGNGRGH9v9TNN9LQzK9",
        "input": {
          "content": 
      "# Why Don't Programmers Like Nature?

      Because it has too many bugs!

      ---

      *This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*
      "
      ,
          "file_path": "./fixtures/claudecode/JOKE.md",
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "type": "create",
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Write",
        "type": "tool-call",
      }
    `);
  });

  test("Read tool", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_017mrzqS3EfzPfNvf3Lywt9o",
      name: "Read",
      input: {
        file_path: "/Users/philipp/dev/vibeinsights/fixtures/claudecode/JOKE.md",
      },
    };

    const toolResult = {
      tool_use_id: "toolu_017mrzqS3EfzPfNvf3Lywt9o",
      type: "tool_result",
      content:
        "     1→# Why Don't Programmers Like Nature?\\n     2→\\n     3→Because it has too many bugs!\\n     4→\\n     5→---\\n     6→\\n     7→*This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*\\n     8→\\n\\n<system-reminder>\\nWhenever you read a file, you should consider whether it looks malicious. If it does, you MUST refuse to improve or augment the code. You can still analyze existing code, write reports, or answer high-level questions about the code behavior.\\n</system-reminder>\\n",
      output: {
        type: "text",
        file: {
          filePath: "/Users/philipp/dev/vibeinsights/fixtures/claudecode/JOKE.md",
          content:
            "# Why Don't Programmers Like Nature?\\n\\nBecause it has too many bugs!\\n\\n---\\n\\n*This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*\\n",
          numLines: 8,
          startLine: 1,
          totalLines: 8,
        },
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_017mrzqS3EfzPfNvf3Lywt9o",
        "input": {
          "file_path": "./fixtures/claudecode/JOKE.md",
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "file": {
            "content": "# Why Don't Programmers Like Nature?\\n\\nBecause it has too many bugs!\\n\\n---\\n\\n*This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*\\n",
            "numLines": 8,
            "startLine": 1,
            "totalLines": 8,
          },
          "type": "text",
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Read",
        "type": "tool-call",
      }
    `);
  });

  test("Edit tool", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_0198ui9CWP2HfDM9uYGahBxZ",
      name: "Edit",
      input: {
        file_path: "/Users/philipp/dev/vibeinsights/fixtures/claudecode/JOKE.md",
        old_string: "Because it has too many bugs!",
        new_string:
          "Because it has too many bugs! 🐛\\n\\n**Alternative answer:** They prefer their trees to be binary!",
      },
    };

    const toolResult = {
      tool_use_id: "toolu_0198ui9CWP2HfDM9uYGahBxZ",
      type: "tool_result",
      content:
        "The file /Users/philipp/dev/vibeinsights/fixtures/claudecode/JOKE.md has been updated. Here's the result of running `cat -n` on a snippet of the edited file:\\n     1→# Why Don't Programmers Like Nature?\\n     2→\\n     3→Because it has too many bugs! 🐛\\n     4→\\n     5→**Alternative answer:** They prefer their trees to be binary!\\n     6→\\n     7→---\\n     8→\\n     9→*This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*",
      output: {
        filePath: "/Users/philipp/dev/vibeinsights/fixtures/claudecode/JOKE.md",
        oldString: "Because it has too many bugs!",
        newString:
          "Because it has too many bugs! 🐛\\n\\n**Alternative answer:** They prefer their trees to be binary!",
        originalFile:
          "# Why Don't Programmers Like Nature?\\n\\nBecause it has too many bugs!\\n\\n---\\n\\n*This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*\\n",
        structuredPatch: [
          {
            oldStart: 1,
            oldLines: 7,
            newStart: 1,
            newLines: 9,
            lines: [
              " # Why Don't Programmers Like Nature?",
              " ",
              "-Because it has too many bugs!",
              "+Because it has too many bugs! 🐛",
              " ",
              "+**Alternative answer:** They prefer their trees to be binary!",
              "+",
              " ---",
              " ",
              " *This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*",
            ],
          },
        ],
        userModified: false,
        replaceAll: false,
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_0198ui9CWP2HfDM9uYGahBxZ",
        "input": {
          "diff": 
      " # Why Don't Programmers Like Nature?
       
      -Because it has too many bugs!
      +Because it has too many bugs! 🐛
       
      +**Alternative answer:** They prefer their trees to be binary!
      +
       ---
       
       *This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*
      "
      ,
          "file_path": "./fixtures/claudecode/JOKE.md",
          "lineOffset": 1,
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "userModified": false,
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Edit",
        "type": "tool-call",
      }
    `);
  });

  test("Bash tool", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_012tuX26pk8gokoCtkcQi6fh",
      name: "Bash",
      input: {
        command: "rm /Users/philipp/dev/vibeinsights/fixtures/claudecode/JOKE.md",
        description: "Delete JOKE.md file",
      },
    };

    const toolResult = {
      tool_use_id: "toolu_012tuX26pk8gokoCtkcQi6fh",
      type: "tool_result",
      content: "",
      output: {
        stdout: "",
        stderr: "",
        interrupted: false,
        isImage: false,
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_012tuX26pk8gokoCtkcQi6fh",
        "input": {
          "command": "rm ./fixtures/claudecode/JOKE.md",
          "description": "Delete JOKE.md file",
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "interrupted": false,
          "isImage": false,
          "stderr": "",
          "stdout": "",
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Bash",
        "type": "tool-call",
      }
    `);
  });

  test("TodoWrite tool", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01Je81y4EA4rLEVUmzqd8sPa",
      name: "TodoWrite",
      input: {
        todos: [
          {
            content: "Complete first task",
            activeForm: "Completing first task",
            status: "pending",
          },
          {
            content: "Complete second task",
            activeForm: "Completing second task",
            status: "pending",
          },
          {
            content: "Complete third task",
            activeForm: "Completing third task",
            status: "pending",
          },
        ],
      },
    };

    const toolResult = {
      tool_use_id: "toolu_01Je81y4EA4rLEVUmzqd8sPa",
      type: "tool_result",
      content:
        "Todos have been modified successfully. Ensure that you continue to use the todo list to track your progress. Please proceed with the current tasks if applicable",
      output: {
        oldTodos: [],
        newTodos: [
          {
            content: "Complete first task",
            status: "pending",
            activeForm: "Completing first task",
          },
          {
            content: "Complete second task",
            status: "pending",
            activeForm: "Completing second task",
          },
          {
            content: "Complete third task",
            status: "pending",
            activeForm: "Completing third task",
          },
        ],
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01Je81y4EA4rLEVUmzqd8sPa",
        "input": {
          "todos": [
            {
              "content": "Complete first task",
              "status": "pending",
            },
            {
              "content": "Complete second task",
              "status": "pending",
            },
            {
              "content": "Complete third task",
              "status": "pending",
            },
          ],
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "newTodos": [
            {
              "content": "Complete first task",
              "status": "pending",
            },
            {
              "content": "Complete second task",
              "status": "pending",
            },
            {
              "content": "Complete third task",
              "status": "pending",
            },
          ],
          "oldTodos": [],
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "TodoWrite",
        "type": "tool-call",
      }
    `);
  });

  test("Task tool (subagent)", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01BuNFczVnbvyf3hBd7oYaqy",
      name: "Task",
      input: {
        subagent_type: "general-purpose",
        description: "Check how agent is doing",
        prompt:
          "Hey there! Just checking in - how are you doing today? \\n\\nPlease respond with how you're doing, and then return your response in your final message back to me. This is just a casual check-in, no coding work needed.",
      },
    };

    const toolResult = {
      tool_use_id: "toolu_01BuNFczVnbvyf3hBd7oYaqy",
      type: "tool_result",
      content: [
        {
          type: "text",
          text: "Hello! I'm doing well, thank you for asking! I'm ready and available to help you with any work on the Tailwind Studio project whenever you need it.\\n\\nSince this is just a casual check-in with no coding tasks required, I'll keep it simple - I'm functioning properly and prepared to assist with development, debugging, architecture questions, or any other needs that come up with your React-based visual design tool.\\n\\nHow are you doing today? Is there anything you'd like to work on with the project, or just checking in?",
        },
      ],
      output: {
        status: "completed",
        prompt:
          "Hey there! Just checking in - how are you doing today? \\n\\nPlease respond with how you're doing, and then return your response in your final message back to me. This is just a casual check-in, no coding work needed.",
        content: [
          {
            type: "text",
            text: "Hello! I'm doing well, thank you for asking! I'm ready and available to help you with any work on the Tailwind Studio project whenever you need it.\\n\\nSince this is just a casual check-in with no coding tasks required, I'll keep it simple - I'm functioning properly and prepared to assist with development, debugging, architecture questions, or any other needs that come up with your React-based visual design tool.\\n\\nHow are you doing today? Is there anything you'd like to work on with the project, or just checking in?",
          },
        ],
        totalDurationMs: 4802,
        totalTokens: 12526,
        totalToolUseCount: 0,
        usage: {
          input_tokens: 4,
          cache_creation_input_tokens: 12405,
          cache_read_input_tokens: 0,
          cache_creation: {
            ephemeral_5m_input_tokens: 12405,
            ephemeral_1h_input_tokens: 0,
          },
          output_tokens: 117,
          service_tier: "standard",
        },
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01BuNFczVnbvyf3hBd7oYaqy",
        "input": {
          "description": "Check how agent is doing",
          "prompt": "Hey there! Just checking in - how are you doing today? \\n\\nPlease respond with how you're doing, and then return your response in your final message back to me. This is just a casual check-in, no coding work needed.",
          "subagent_type": "general-purpose",
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "content": [
            {
              "text": "Hello! I'm doing well, thank you for asking! I'm ready and available to help you with any work on the Tailwind Studio project whenever you need it.\\n\\nSince this is just a casual check-in with no coding tasks required, I'll keep it simple - I'm functioning properly and prepared to assist with development, debugging, architecture questions, or any other needs that come up with your React-based visual design tool.\\n\\nHow are you doing today? Is there anything you'd like to work on with the project, or just checking in?",
              "type": "text",
            },
          ],
          "status": "completed",
          "totalDurationMs": 4802,
          "totalToolUseCount": 0,
          "usage": {
            "cachedInputTokens": 12405,
            "inputTokens": 4,
            "outputTokens": 117,
            "reasoningOutputTokens": 0,
            "totalTokens": 12526,
          },
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Task",
        "type": "tool-call",
      }
    `);
  });

  test("Glob tool - success", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01UyCBtjecmBzJtxbDdt6AwH",
      name: "Glob",
      input: {
        pattern: "**/wrangler.jsonc",
      },
    };

    const toolResult = {
      tool_use_id: "toolu_01UyCBtjecmBzJtxbDdt6AwH",
      type: "tool_result",
      content: "/Users/philipp/dev/vibeinsights/packages/server/wrangler.jsonc",
      output: {
        filenames: ["/Users/philipp/dev/vibeinsights/packages/server/wrangler.jsonc"],
        durationMs: 48,
        numFiles: 1,
        truncated: false,
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01UyCBtjecmBzJtxbDdt6AwH",
        "input": {
          "pattern": "**/wrangler.jsonc",
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "durationMs": 48,
          "filenames": [
            "./packages/server/wrangler.jsonc",
          ],
          "truncated": false,
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Glob",
        "type": "tool-call",
      }
    `);
  });

  test("Glob tool - no results", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01H6os5tnvhHzWAnMk1AKMKD",
      name: "Glob",
      input: {
        pattern: "**/*.sqlite",
      },
    };

    const toolResult = {
      tool_use_id: "toolu_01H6os5tnvhHzWAnMk1AKMKD",
      type: "tool_result",
      content: "No files found",
      output: {
        filenames: [],
        durationMs: 88,
        numFiles: 0,
        truncated: false,
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01H6os5tnvhHzWAnMk1AKMKD",
        "input": {
          "pattern": "**/*.sqlite",
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "durationMs": 88,
          "filenames": [],
          "truncated": false,
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Glob",
        "type": "tool-call",
      }
    `);
  });

  test("Grep tool - files_with_matches mode", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01SgXEtQKNAkoVwAC8qAeaEB",
      name: "Grep",
      input: {
        pattern: "cf-typegen",
        output_mode: "files_with_matches",
      },
    };

    const toolResult = {
      tool_use_id: "toolu_01SgXEtQKNAkoVwAC8qAeaEB",
      type: "tool_result",
      content:
        "Found 3 files\\n/Users/philipp/dev/vibeinsights/packages/server/package.json\\n/Users/philipp/dev/vibeinsights/.github/workflows/ci.yml\\n/Users/philipp/dev/vibeinsights/packages/server/README.md",
      output: {
        mode: "files_with_matches",
        filenames: [
          "/Users/philipp/dev/vibeinsights/packages/server/package.json",
          "/Users/philipp/dev/vibeinsights/.github/workflows/ci.yml",
          "/Users/philipp/dev/vibeinsights/packages/server/README.md",
        ],
        numFiles: 3,
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01SgXEtQKNAkoVwAC8qAeaEB",
        "input": {
          "output_mode": "files_with_matches",
          "pattern": "cf-typegen",
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "filenames": [
            "./packages/server/package.json",
            "./.github/workflows/ci.yml",
            "./packages/server/README.md",
          ],
          "mode": "files_with_matches",
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Grep",
        "type": "tool-call",
      }
    `);
  });

  test("Grep tool - content mode with line numbers", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01ULWHVCD4z7DDv8hw7THVUr",
      name: "Grep",
      input: {
        pattern: "useSession|isPending",
        output_mode: "content",
        "-n": true,
        glob: "**/*.tsx",
      },
    };

    const toolResult = {
      tool_use_id: "toolu_01ULWHVCD4z7DDv8hw7THVUr",
      type: "tool_result",
      content:
        "/Users/philipp/dev/vibeinsights/packages/server/src/routes/__root.tsx:43:  const { data: session, isPending } = authClient.useSession();\\n/Users/philipp/dev/vibeinsights/packages/server/src/routes/__root.tsx:116:            ) : isPending ? (",
      output: {
        mode: "content",
        numFiles: 0,
        filenames: [],
        content:
          "/Users/philipp/dev/vibeinsights/packages/server/src/routes/__root.tsx:43:  const { data: session, isPending } = authClient.useSession();\\n/Users/philipp/dev/vibeinsights/packages/server/src/routes/__root.tsx:116:            ) : isPending ? (",
        numLines: 2,
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01ULWHVCD4z7DDv8hw7THVUr",
        "input": {
          "-n": true,
          "glob": "**/*.tsx",
          "output_mode": "content",
          "pattern": "useSession|isPending",
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "content": "./packages/server/src/routes/__root.tsx:43:  const { data: session, isPending } = authClient.useSession();\\n./packages/server/src/routes/__root.tsx:116:            ) : isPending ? (",
          "filenames": [],
          "mode": "content",
          "numLines": 2,
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Grep",
        "type": "tool-call",
      }
    `);
  });

  test("Read tool - file does not exist error", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01CYjE2vfnb1ypceQX6LJHV4",
      name: "Read",
      input: {
        file_path: "/Users/philipp/dev/vibeinsights/wrangler.jsonc",
      },
    };

    const toolResult = {
      type: "tool_result",
      content: "<tool_use_error>File does not exist.</tool_use_error>",
      is_error: true,
      tool_use_id: "toolu_01CYjE2vfnb1ypceQX6LJHV4",
      output: "Error: File does not exist.",
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01CYjE2vfnb1ypceQX6LJHV4",
        "input": {
          "file_path": "./wrangler.jsonc",
        },
        "isError": true,
        "model": "claude-sonnet-4-5-20250929",
        "output": "Error: File does not exist.",
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Read",
        "type": "tool-call",
      }
    `);
  });

  test("Bash tool - command error with exit code 1", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01WtSaAxn9CnrESspMmyGdjd",
      name: "Bash",
      input: {
        command: "bun run format:check",
        description: "Check code formatting",
      },
    };

    const toolResult = {
      type: "tool_result",
      content:
        '$ prettier --check .\\n[warn] packages/cli/src/commands/hook.ts\\n[warn] packages/cli/src/commands/upload.ts\\n[warn] packages/cli/src/config.ts\\n[warn] packages/cli/src/env-config.ts\\n[warn] packages/cli/src/index.ts\\n[warn] packages/cli/src/lib/perform-upload.ts\\n[warn] packages/server/wrangler.jsonc\\n[warn] Code style issues found in 7 files. Run Prettier with --write to fix.\\nerror: script \\"format:check\\" exited with code 1\\n\\nChecking formatting...',
      is_error: true,
      tool_use_id: "toolu_01WtSaAxn9CnrESspMmyGdjd",
      output:
        'Error: $ prettier --check .\\n[warn] packages/cli/src/commands/hook.ts\\n[warn] packages/cli/src/commands/upload.ts\\n[warn] packages/cli/src/config.ts\\n[warn] packages/cli/src/env-config.ts\\n[warn] packages/cli/src/index.ts\\n[warn] packages/cli/src/lib/perform-upload.ts\\n[warn] packages/server/wrangler.jsonc\\n[warn] Code style issues found in 7 files. Run Prettier with --write to fix.\\nerror: script \\"format:check\\" exited with code 1\\n\\nChecking formatting...',
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01WtSaAxn9CnrESspMmyGdjd",
        "input": {
          "command": "bun run format:check",
          "description": "Check code formatting",
        },
        "isError": true,
        "model": "claude-sonnet-4-5-20250929",
        "output": "Error: $ prettier --check .\\n[warn] packages/cli/src/commands/hook.ts\\n[warn] packages/cli/src/commands/upload.ts\\n[warn] packages/cli/src/config.ts\\n[warn] packages/cli/src/env-config.ts\\n[warn] packages/cli/src/index.ts\\n[warn] packages/cli/src/lib/perform-upload.ts\\n[warn] packages/server/wrangler.jsonc\\n[warn] Code style issues found in 7 files. Run Prettier with --write to fix.\\nerror: script \\"format:check\\" exited with code 1\\n\\nChecking formatting...",
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Bash",
        "type": "tool-call",
      }
    `);
  });

  test("Bash tool - background execution", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01J69ocxnRTejAph2xtxpkg2",
      name: "Bash",
      input: {
        command: "cd /Users/philipp/dev/vibeinsights/packages/server && bun run dev",
        description: "Start dev server to test fixes",
        timeout: 30000,
        run_in_background: true,
      },
    };

    const toolResult = {
      tool_use_id: "toolu_01J69ocxnRTejAph2xtxpkg2",
      type: "tool_result",
      content: "Command running in background with ID: 42d965",
      output: {
        stdout: "",
        stderr: "",
        interrupted: false,
        isImage: false,
        backgroundTaskId: "42d965",
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01J69ocxnRTejAph2xtxpkg2",
        "input": {
          "command": "cd ./packages/server && bun run dev",
          "description": "Start dev server to test fixes",
          "run_in_background": true,
          "timeout": 30000,
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "backgroundTaskId": "42d965",
          "interrupted": false,
          "isImage": false,
          "stderr": "",
          "stdout": "",
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Bash",
        "type": "tool-call",
      }
    `);
  });

  test("BashOutput tool - failed background task", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01255yZK784x1zySe8eQyxDE",
      name: "BashOutput",
      input: {
        bash_id: "bc7034",
      },
    };

    const toolResult = {
      tool_use_id: "toolu_01255yZK784x1zySe8eQyxDE",
      type: "tool_result",
      content:
        "<status>failed</status>\\n\\n<exit_code>1</exit_code>\\n\\n<stderr>\\n(eval):cd:1: no such file or directory: packages/server\\n</stderr>\\n\\n<timestamp>2025-10-12T22:47:37.626Z</timestamp>",
      output: {
        shellId: "bc7034",
        command: "cd packages/server && bun run dev",
        status: "failed",
        exitCode: 1,
        stdout: "",
        stderr: "(eval):cd:1: no such file or directory: packages/server",
        stdoutLines: 1,
        stderrLines: 1,
        timestamp: "2025-10-12T22:47:37.626Z",
      },
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01255yZK784x1zySe8eQyxDE",
        "input": {
          "bash_id": "bc7034",
        },
        "model": "claude-sonnet-4-5-20250929",
        "output": {
          "command": "cd packages/server && bun run dev",
          "exitCode": 1,
          "shellId": "bc7034",
          "status": "failed",
          "stderr": "(eval):cd:1: no such file or directory: packages/server",
          "stdout": "",
          "timestamp": "2025-10-12T22:47:37.626Z",
        },
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "BashOutput",
        "type": "tool-call",
      }
    `);
  });

  test("KillShell tool - shell already killed error", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01KRfkxeW3fyvb46jyCCZ6q6",
      name: "KillShell",
      input: {
        shell_id: "42d965",
      },
    };

    const toolResult = {
      type: "tool_result",
      content: "Shell 42d965 is not running, so cannot be killed (status: killed)",
      is_error: true,
      tool_use_id: "toolu_01KRfkxeW3fyvb46jyCCZ6q6",
      output: "Error: Shell 42d965 is not running, so cannot be killed (status: killed)",
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01KRfkxeW3fyvb46jyCCZ6q6",
        "input": {
          "shell_id": "42d965",
        },
        "isError": "true",
        "model": "claude-sonnet-4-5-20250929",
        "output": "Error: Shell 42d965 is not running, so cannot be killed (status: killed)",
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "KillShell",
        "type": "tool-call",
      }
    `);
  });

  test("Read tool - parallel tool calls should all have outputs", () => {
    // This reproduces a real transcript where 3 Read tool calls are made in parallel
    // Each tool call has parentUuid pointing to the previous tool call (chain)
    // Each tool result has parentUuid pointing to ITS corresponding tool call (branches)
    // The bug: only one branch is followed, so other results are lost
    const transcript = [
      // Tool call 1: Read upload.e2e.ts
      {
        type: "assistant",
        uuid: "27b70804-2789-427d-9474-d18362c99437",
        parentUuid: "efbe9db4-d94c-4586-872a-75a9fc52b2a0",
        timestamp: "2026-01-13T21:41:06.998Z",
        cwd: "/Users/philipp/dev/agentlogs",
        message: {
          model: "claude-opus-4-5-20251101",
          id: "msg_01JyJaCZbJakFCouADNoo8ue",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_01TL7Z741dYC6cw5UE8G1gcY",
              name: "Read",
              input: { file_path: "/Users/philipp/dev/agentlogs/packages/e2e/tests/upload.e2e.ts" },
            },
          ],
        },
      },
      // Tool call 2: Read dashboard.e2e.ts (parentUuid points to tool call 1)
      {
        type: "assistant",
        uuid: "660e51c4-444b-47bb-9dfe-1172b3faa875",
        parentUuid: "27b70804-2789-427d-9474-d18362c99437",
        timestamp: "2026-01-13T21:41:07.385Z",
        cwd: "/Users/philipp/dev/agentlogs",
        message: {
          model: "claude-opus-4-5-20251101",
          id: "msg_01JyJaCZbJakFCouADNoo8ue",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_01S7imUfpo6H77JGShmXndGm",
              name: "Read",
              input: { file_path: "/Users/philipp/dev/agentlogs/packages/e2e/tests/ui/dashboard.e2e.ts" },
            },
          ],
        },
      },
      // Tool call 3: Read playwright.config.ts (parentUuid points to tool call 2)
      {
        type: "assistant",
        uuid: "b5077707-4b94-4e0e-90e8-f9481ed9f0eb",
        parentUuid: "660e51c4-444b-47bb-9dfe-1172b3faa875",
        timestamp: "2026-01-13T21:41:07.831Z",
        cwd: "/Users/philipp/dev/agentlogs",
        message: {
          model: "claude-opus-4-5-20251101",
          id: "msg_01JyJaCZbJakFCouADNoo8ue",
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "toolu_01F67qtCogiUdEt1E9RsrxPN",
              name: "Read",
              input: { file_path: "/Users/philipp/dev/agentlogs/packages/e2e/playwright.config.ts" },
            },
          ],
        },
      },
      // Tool result 1: Result for upload.e2e.ts (parentUuid points to tool call 1 - BRANCHES OFF)
      {
        type: "user",
        uuid: "22769e4d-85e1-4a8e-9c5d-8f1e67e208b2",
        parentUuid: "27b70804-2789-427d-9474-d18362c99437",
        timestamp: "2026-01-13T21:41:07.885Z",
        cwd: "/Users/philipp/dev/agentlogs",
        message: {
          role: "user",
          content: [
            {
              tool_use_id: "toolu_01TL7Z741dYC6cw5UE8G1gcY",
              type: "tool_result",
              content: "import { test } from '@playwright/test';",
            },
          ],
        },
        toolUseResult: {
          type: "text",
          file: {
            filePath: "/Users/philipp/dev/agentlogs/packages/e2e/tests/upload.e2e.ts",
            content: "import { test } from '@playwright/test';",
            numLines: 1,
            startLine: 1,
            totalLines: 1,
          },
        },
      },
      // Tool result 2: Result for dashboard.e2e.ts (parentUuid points to tool call 2 - BRANCHES OFF)
      {
        type: "user",
        uuid: "7b7a15eb-bd9d-4ecc-89a6-2ac8302a3e4c",
        parentUuid: "660e51c4-444b-47bb-9dfe-1172b3faa875",
        timestamp: "2026-01-13T21:41:07.885Z",
        cwd: "/Users/philipp/dev/agentlogs",
        message: {
          role: "user",
          content: [
            {
              tool_use_id: "toolu_01S7imUfpo6H77JGShmXndGm",
              type: "tool_result",
              content: "import { test } from '@playwright/test'; // dashboard",
            },
          ],
        },
        toolUseResult: {
          type: "text",
          file: {
            filePath: "/Users/philipp/dev/agentlogs/packages/e2e/tests/ui/dashboard.e2e.ts",
            content: "import { test } from '@playwright/test'; // dashboard",
            numLines: 1,
            startLine: 1,
            totalLines: 1,
          },
        },
      },
      // Tool result 3: Result for playwright.config.ts (parentUuid points to tool call 3 - on main chain)
      {
        type: "user",
        uuid: "2eeaaddd-2013-4248-9f03-626d4f6a238b",
        parentUuid: "b5077707-4b94-4e0e-90e8-f9481ed9f0eb",
        timestamp: "2026-01-13T21:41:07.885Z",
        cwd: "/Users/philipp/dev/agentlogs",
        message: {
          role: "user",
          content: [
            {
              tool_use_id: "toolu_01F67qtCogiUdEt1E9RsrxPN",
              type: "tool_result",
              content: "import { defineConfig } from '@playwright/test';",
            },
          ],
        },
        toolUseResult: {
          type: "text",
          file: {
            filePath: "/Users/philipp/dev/agentlogs/packages/e2e/playwright.config.ts",
            content: "import { defineConfig } from '@playwright/test';",
            numLines: 1,
            startLine: 1,
            totalLines: 1,
          },
        },
      },
    ];

    const converted = convertClaudeCodeTranscript(transcript);
    const toolCalls = converted?.transcript.messages.filter((m) => m.type === "tool-call");

    // We expect 3 tool calls, all with their outputs
    expect(toolCalls).toHaveLength(3);

    // Check each tool call has its output
    const readCalls = toolCalls as Array<{ toolName: string; input: any; output: any }>;

    const uploadCall = readCalls.find((c) => c.input?.file_path?.includes("upload.e2e.ts"));
    const dashboardCall = readCalls.find((c) => c.input?.file_path?.includes("dashboard.e2e.ts"));
    const configCall = readCalls.find((c) => c.input?.file_path?.includes("playwright.config.ts"));

    // All three should have output with file content
    expect(uploadCall?.output?.file?.content).toBe("import { test } from '@playwright/test';");
    expect(dashboardCall?.output?.file?.content).toBe("import { test } from '@playwright/test'; // dashboard");
    expect(configCall?.output?.file?.content).toBe("import { defineConfig } from '@playwright/test';");
  });

  test("Edit tool - file not read first error", () => {
    const toolUse = {
      type: "tool_use",
      id: "toolu_01BNkRVXhbTP8FmVcADLGfhF",
      name: "Edit",
      input: {
        replace_all: true,
        file_path: "/Users/philipp/dev/vibeinsights/packages/cli/src/index.ts",
        old_string: "  login                 Authenticate the CLI via GitHub device flow.",
        new_string: "  login                 Authenticate the CLI via device authorization flow.",
      },
    };

    const toolResult = {
      type: "tool_result",
      content: "<tool_use_error>File has not been read yet. Read it first before writing to it.</tool_use_error>",
      is_error: true,
      tool_use_id: "toolu_01BNkRVXhbTP8FmVcADLGfhF",
      output: "Error: File has not been read yet. Read it first before writing to it.",
    };

    const toolCall = processToolCall(toolUse, toolResult);

    expect(toolCall).toMatchInlineSnapshot(`
      {
        "id": "toolu_01BNkRVXhbTP8FmVcADLGfhF",
        "input": {
          "diff": 
      "-  login                 Authenticate the CLI via GitHub device flow.
      +  login                 Authenticate the CLI via device authorization flow.
      "
      ,
          "file_path": "./packages/cli/src/index.ts",
          "replace_all": true,
        },
        "isError": true,
        "model": "claude-sonnet-4-5-20250929",
        "output": "Error: File has not been read yet. Read it first before writing to it.",
        "timestamp": "2025-10-12T21:36:00.000Z",
        "toolName": "Edit",
        "type": "tool-call",
      }
    `);
  });
});
