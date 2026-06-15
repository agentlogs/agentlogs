import path from "node:path";
import { describe, expect, test } from "bun:test";
import { convertClaudeCodeFile, convertClaudeCodeTranscript, type ConversionResult } from "./claudecode";
import { formatCwdWithTilde } from "./paths";

const FIXTURE_DIR = path.resolve(import.meta.dir, "../../../fixtures/claudecode");

const TEST_NOW = new Date("2025-10-15T12:00:00Z");

const TEST_PRICING = {
  "claude-sonnet-4-5-20250929": {
    input_cost_per_token: 3e-6,
    output_cost_per_token: 1.5e-5,
    cache_creation_input_token_cost: 3e-6,
    cache_read_input_token_cost: 3e-7,
  },
};

// Git contexts for each fixture
const FIXTURE_GIT_CONTEXTS: Record<string, { repo: string; branch: string; relativeCwd: string }> = {
  "compact.jsonl": {
    repo: "github.com/vibeinsights/vibeinsights",
    branch: "main",
    relativeCwd: "",
  },
  "crud.jsonl": {
    repo: "github.com/vibeinsights/vibeinsights",
    branch: "main",
    relativeCwd: "fixtures/claudecode",
  },
  "subagent.jsonl": {
    repo: "github.com/vibeinsights/vibeinsights",
    branch: "main",
    relativeCwd: "",
  },
  "todos.jsonl": {
    repo: "github.com/vibeinsights/vibeinsights",
    branch: "main",
    relativeCwd: "fixtures/claudecode",
  },
};

describe("convertClaudeCodeFile", () => {
  test("compact.jsonl", async () => {
    const serialized = await loadSerializedTranscript("compact.jsonl");
    expect(serialized.transcript.cwd).toBe(formatCwdWithTilde("/Users/philipp/dev/studio"));
    expect(serialized).toMatchInlineSnapshot(`
      {
        "blobs": {
          "count": 0,
          "sha256s": [],
        },
        "transcript": {
          "blendedTokens": 2286,
          "clientVersion": "2.0.13",
          "costUsd": 0.0126906,
          "cwd": "~/dev/studio",
          "filesChanged": 0,
          "git": {
            "branch": "main",
            "relativeCwd": "",
            "repo": "github.com/vibeinsights/vibeinsights",
          },
          "id": "0e26ec2f-937e-482c-b889-bc126f996913",
          "linesAdded": 0,
          "linesModified": 0,
          "linesRemoved": 0,
          "messageCount": 5,
          "messages": [
            {
              "id": "3648cc91-eee4-4a25-bad3-31104269d5b8",
              "text": "how are you doing",
              "timestamp": "2025-10-10T21:56:06.117Z",
              "type": "user",
            },
            {
              "id": "msg_01M6vNscvMpr7b1s2YSbXXaS",
              "model": "claude-sonnet-4-5-20250929",
              "text": 
      "The user is asking "how are you doing" - this is a casual greeting/check-in question. Based on the instructions, I should be concise and professional. I shouldn't be overly verbose or use emojis unless requested. This is not a technical task, so I don't need to use the TodoWrite tool or any other tools.

      I should respond in a friendly but brief manner, acknowledging the greeting and indicating I'm ready to help with their work."
      ,
              "timestamp": "2025-10-10T21:56:10.872Z",
              "type": "thinking",
            },
            {
              "id": "msg_01M6vNscvMpr7b1s2YSbXXaS",
              "model": "claude-sonnet-4-5-20250929",
              "text": "I'm doing well, thanks for asking! Ready to help you with Tailwind Studio or any other coding tasks you have in mind. What would you like to work on today?",
              "timestamp": "2025-10-10T21:56:11.722Z",
              "type": "agent",
            },
            {
              "id": "cff5fe4f-d7c3-4631-8580-3176d62c0e62",
              "text": 
      "This session is being continued from a previous conversation that ran out of context. The conversation is summarized below:
      Analysis:
      Let me analyze the conversation chronologically:

      1. **Message 1**: User ran \`/clear\` command (local command, should be ignored per instructions)
      2. **Message 2**: User asked "how are you doing"
      3. **Message 3**: I responded politely that I'm doing well and asked what they'd like to work on
      4. **Message 4**: User is now requesting a detailed summary of the conversation

      This is a very brief conversation with minimal technical content. The user has:
      - Cleared the conversation history
      - Made a casual greeting
      - Requested a summary

      There have been NO:
      - Technical requests
      - File operations
      - Code changes
      - Errors
      - Problem solving
      - Pending tasks
      - Current work in progress

      The conversation literally just started after a clear command, so there is essentially nothing to summarize in terms of development work, technical decisions, or code patterns.

      Summary:
      1. Primary Request and Intent:
         The user cleared the conversation history, made a casual greeting ("how are you doing"), and then requested a detailed summary of the conversation. There have been no explicit technical requests or development intents expressed in this conversation.

      2. Key Technical Concepts:
         None discussed in this conversation.

      3. Files and Code Sections:
         No files have been read, modified, or created in this conversation.

      4. Errors and fixes:
         No errors encountered in this conversation.

      5. Problem Solving:
         No problems have been addressed or troubleshooting efforts undertaken in this conversation.

      6. All user messages:
         - "how are you doing"
         - [Current request for conversation summary]

      7. Pending Tasks:
         No pending tasks have been identified or requested.

      8. Current Work:
         No development work was being performed before this summary request. The conversation just began after a \`/clear\` command, with only a casual greeting exchange before the summary was requested.

      9. Optional Next Step:
         None. There is no ongoing work to continue. Awaiting the user's next request or direction for what they would like to work on.."
      ,
              "timestamp": "2025-10-10T21:57:51.963Z",
              "type": "compaction-summary",
            },
            {
              "args": undefined,
              "id": "224e95a0-d3da-4754-9410-eadf74f8b03e",
              "name": "/compact",
              "output": "Compacted (ctrl+o to see full summary)",
              "timestamp": "2025-10-10T21:57:40.406Z",
              "type": "command",
            },
          ],
          "model": "anthropic/claude-sonnet-4-5-20250929",
          "modelUsage": [
            {
              "model": "anthropic/claude-sonnet-4-5-20250929",
              "usage": {
                "cachedInputTokens": 13522,
                "inputTokens": 15660,
                "outputTokens": 148,
                "reasoningOutputTokens": 0,
                "totalTokens": 15808,
              },
            },
          ],
          "preview": "how are you doing",
          "source": "claude-code",
          "summary": null,
          "timestamp": "2025-10-10T21:57:52.066Z",
          "tokenUsage": {
            "cachedInputTokens": 13522,
            "inputTokens": 15660,
            "outputTokens": 148,
            "reasoningOutputTokens": 0,
            "totalTokens": 15808,
          },
          "toolCount": 0,
          "userMessageCount": 1,
          "v": 1,
        },
      }
    `);
  });

  test("crud.jsonl", async () => {
    const serialized = await loadSerializedTranscript("crud.jsonl");
    expect(serialized.transcript.cwd).toBe(formatCwdWithTilde("/Users/philipp/dev/vibeinsights/fixtures/claudecode"));
    expect(serialized).toMatchInlineSnapshot(`
      {
        "blobs": {
          "count": 0,
          "sha256s": [],
        },
        "transcript": {
          "blendedTokens": 14126,
          "clientVersion": "2.0.14",
          "costUsd": 0.10516139999999999,
          "cwd": "~/dev/vibeinsights/fixtures/claudecode",
          "filesChanged": 1,
          "git": {
            "branch": "main",
            "relativeCwd": "fixtures/claudecode",
            "repo": "github.com/vibeinsights/vibeinsights",
          },
          "id": "8122657c-fe54-4dc9-89a3-20049e8a84f7",
          "linesAdded": 10,
          "linesModified": 1,
          "linesRemoved": 0,
          "messageCount": 16,
          "messages": [
            {
              "id": "03ffd31e-6bc0-4899-9df7-9b484cfda8cf",
              "text": "create a file \`JOKE.md\` with a ranom joke with a title and a footer wiht some random text, then read this file, then make change to the file, then delete this file.",
              "timestamp": "2025-10-12T21:35:53.825Z",
              "type": "user",
            },
            {
              "id": "msg_017DQYxTBUopfF6hAzwhgCfu",
              "model": "claude-sonnet-4-5-20250929",
              "text": "I'll help you create, read, modify, and delete a JOKE.md file. Let me break this down into steps:",
              "timestamp": "2025-10-12T21:35:57.104Z",
              "type": "agent",
            },
            {
              "id": "msg_017DQYxTBUopfF6hAzwhgCfu",
              "input": {
                "todos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "in_progress",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "pending",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "pending",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "pending",
                  },
                ],
              },
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "newTodos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "in_progress",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "pending",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "pending",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "pending",
                  },
                ],
                "oldTodos": [],
              },
              "timestamp": "2025-10-12T21:35:59.363Z",
              "toolName": "TodoWrite",
              "type": "tool-call",
            },
            {
              "id": "msg_01QNb8pLhv5fC4zzZCWWmETv",
              "model": "claude-sonnet-4-5-20250929",
              "text": "Now let me create the JOKE.md file:",
              "timestamp": "2025-10-12T21:36:02.923Z",
              "type": "agent",
            },
            {
              "id": "msg_01QNb8pLhv5fC4zzZCWWmETv",
              "input": {
                "content": 
      "# Why Don't Programmers Like Nature?

      Because it has too many bugs!

      ---

      *This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*
      "
      ,
                "file_path": "./JOKE.md",
              },
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "type": "create",
              },
              "timestamp": "2025-10-12T21:36:05.153Z",
              "toolName": "Write",
              "type": "tool-call",
            },
            {
              "id": "msg_01EPMD36Pf5TTces5YEB6XCp",
              "input": {
                "todos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "completed",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "in_progress",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "pending",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "pending",
                  },
                ],
              },
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "newTodos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "completed",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "in_progress",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "pending",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "pending",
                  },
                ],
                "oldTodos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "in_progress",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "pending",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "pending",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "pending",
                  },
                ],
              },
              "timestamp": "2025-10-12T21:36:09.512Z",
              "toolName": "TodoWrite",
              "type": "tool-call",
            },
            {
              "id": "msg_01JiNaWLgS4VrfjFK1y6uJ56",
              "model": "claude-sonnet-4-5-20250929",
              "text": "Now let me read the file:",
              "timestamp": "2025-10-12T21:36:13.201Z",
              "type": "agent",
            },
            {
              "id": "msg_01JiNaWLgS4VrfjFK1y6uJ56",
              "input": {
                "file_path": "./JOKE.md",
              },
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "file": {
                  "content": 
      "# Why Don't Programmers Like Nature?

      Because it has too many bugs!

      ---

      *This joke brought to you by the Department of Computer Comedy. Remember, there are only 10 types of people in the world: those who understand binary and those who don't.*
      "
      ,
                  "numLines": 8,
                  "startLine": 1,
                  "totalLines": 8,
                },
                "type": "text",
              },
              "timestamp": "2025-10-12T21:36:13.605Z",
              "toolName": "Read",
              "type": "tool-call",
            },
            {
              "id": "msg_01JiRJzfyp6vaEWJxj26DagJ",
              "input": {
                "todos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "completed",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "in_progress",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "pending",
                  },
                ],
              },
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "newTodos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "completed",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "in_progress",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "pending",
                  },
                ],
                "oldTodos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "completed",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "in_progress",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "pending",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "pending",
                  },
                ],
              },
              "timestamp": "2025-10-12T21:36:17.703Z",
              "toolName": "TodoWrite",
              "type": "tool-call",
            },
            {
              "id": "msg_01MwBdz2tFJGVscNoMYjucr1",
              "model": "claude-sonnet-4-5-20250929",
              "text": "Now let me make a change to the file:",
              "timestamp": "2025-10-12T21:36:20.048Z",
              "type": "agent",
            },
            {
              "id": "msg_01MwBdz2tFJGVscNoMYjucr1",
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
                "file_path": "./JOKE.md",
                "lineOffset": 1,
              },
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "userModified": false,
              },
              "timestamp": "2025-10-12T21:36:21.679Z",
              "toolName": "Edit",
              "type": "tool-call",
            },
            {
              "id": "msg_01YEVA42WgdVk4e8xtuHmYKM",
              "input": {
                "todos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "completed",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "in_progress",
                  },
                ],
              },
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "newTodos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "completed",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "in_progress",
                  },
                ],
                "oldTodos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "completed",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "in_progress",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "pending",
                  },
                ],
              },
              "timestamp": "2025-10-12T21:36:26.216Z",
              "toolName": "TodoWrite",
              "type": "tool-call",
            },
            {
              "id": "msg_019eSytZmTcXtB5z3wBAP41E",
              "model": "claude-sonnet-4-5-20250929",
              "text": "Finally, let me delete the file:",
              "timestamp": "2025-10-12T21:36:30.007Z",
              "type": "agent",
            },
            {
              "id": "msg_019eSytZmTcXtB5z3wBAP41E",
              "input": {
                "command": "rm ./JOKE.md",
                "description": "Delete JOKE.md file",
              },
              "isError": false,
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "interrupted": false,
                "isImage": false,
                "stderr": "",
                "stdout": "",
              },
              "timestamp": "2025-10-12T21:36:30.934Z",
              "toolName": "Bash",
              "type": "tool-call",
            },
            {
              "id": "msg_01M9UkWxCpEQ9nRSw47wTz5W",
              "input": {
                "todos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "completed",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "completed",
                  },
                ],
              },
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "newTodos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "completed",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "completed",
                  },
                ],
                "oldTodos": [
                  {
                    "content": "Create JOKE.md file with a joke, title, and footer",
                    "status": "completed",
                  },
                  {
                    "content": "Read the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Make changes to the JOKE.md file",
                    "status": "completed",
                  },
                  {
                    "content": "Delete the JOKE.md file",
                    "status": "in_progress",
                  },
                ],
              },
              "timestamp": "2025-10-12T21:36:35.652Z",
              "toolName": "TodoWrite",
              "type": "tool-call",
            },
            {
              "id": "msg_01WDawW8oMKaYitz5hbU4qgg",
              "model": "claude-sonnet-4-5-20250929",
              "text": 
      "All done! I've completed all the steps:

      1. ✓ Created JOKE.md with a programming joke, title, and footer
      2. ✓ Read the file and displayed its contents
      3. ✓ Modified the file by adding an alternative punchline
      4. ✓ Deleted the file

      The file has been successfully removed from your working directory."
      ,
              "timestamp": "2025-10-12T21:36:39.886Z",
              "type": "agent",
            },
          ],
          "model": "anthropic/claude-sonnet-4-5-20250929",
          "modelUsage": [
            {
              "model": "anthropic/claude-sonnet-4-5-20250929",
              "usage": {
                "cachedInputTokens": 148958,
                "inputTokens": 161576,
                "outputTokens": 1508,
                "reasoningOutputTokens": 0,
                "totalTokens": 163084,
              },
            },
          ],
          "preview": "create a file \`JOKE.md\` with a ranom joke with a title and a footer wiht some random text, then read this file, then make change to the file, then delete this file.",
          "source": "claude-code",
          "summary": null,
          "timestamp": "2025-10-12T21:36:39.886Z",
          "tokenUsage": {
            "cachedInputTokens": 148958,
            "inputTokens": 161576,
            "outputTokens": 1508,
            "reasoningOutputTokens": 0,
            "totalTokens": 163084,
          },
          "toolCount": 9,
          "userMessageCount": 1,
          "v": 1,
        },
      }
    `);
  });

  test("subagent.jsonl", async () => {
    const serialized = await loadSerializedTranscript("subagent.jsonl");
    expect(serialized.transcript.cwd).toBe(formatCwdWithTilde("/Users/philipp/dev/studio"));
    expect(serialized).toMatchInlineSnapshot(`
      {
        "blobs": {
          "count": 0,
          "sha256s": [],
        },
        "transcript": {
          "blendedTokens": 10896,
          "clientVersion": "2.0.13",
          "costUsd": 0.040881600000000004,
          "cwd": "~/dev/studio",
          "filesChanged": 0,
          "git": {
            "branch": "main",
            "relativeCwd": "",
            "repo": "github.com/vibeinsights/vibeinsights",
          },
          "id": "609efeca-2f51-4118-b077-e91c9fe63f73",
          "linesAdded": 0,
          "linesModified": 0,
          "linesRemoved": 0,
          "messageCount": 6,
          "messages": [
            {
              "id": "d4051f12-b400-4141-b750-c5a6a0144cf2",
              "text": "ask a subagent how he's doing",
              "timestamp": "2025-10-10T21:54:58.634Z",
              "type": "user",
            },
            {
              "id": "msg_01J9fhCd93KbDV2ck2qE8K4d",
              "model": "claude-sonnet-4-5-20250929",
              "text": 
      "The user is asking me to "ask a subagent how he's doing". This is a bit of an unusual request - they want me to use the Task tool to launch a subagent and essentially just have a casual conversation with it.

      This doesn't really fit any of the specialized agent types described:
      - general-purpose: For researching complex questions, searching for code, and executing multi-step tasks
      - statusline-setup: For configuring status line settings
      - output-style-setup: For creating output styles

      None of these are meant for casual conversation. However, I could use the general-purpose agent and give it a simple task of responding to a greeting or question about how it's doing.

      This seems like a somewhat playful/experimental request from the user. I should just go ahead and do it - launch a general-purpose agent with a simple prompt asking how it's doing."
      ,
              "timestamp": "2025-10-10T21:55:06.403Z",
              "type": "thinking",
            },
            {
              "id": "msg_01J9fhCd93KbDV2ck2qE8K4d",
              "model": "claude-sonnet-4-5-20250929",
              "text": "I'll launch a general-purpose agent and check in on them!",
              "timestamp": "2025-10-10T21:55:06.990Z",
              "type": "agent",
            },
            {
              "id": "msg_01J9fhCd93KbDV2ck2qE8K4d",
              "input": {
                "description": "Check how agent is doing",
                "prompt": 
      "Hey there! Just checking in - how are you doing today? 

      Please respond with how you're doing, and then return your response in your final message back to me. This is just a casual check-in, no coding work needed."
      ,
                "subagent_type": "general-purpose",
              },
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "content": [
                  {
                    "text": 
      "Hello! I'm doing well, thank you for asking! I'm ready and available to help you with any work on the Tailwind Studio project whenever you need it.

      Since this is just a casual check-in with no coding tasks required, I'll keep it simple - I'm functioning properly and prepared to assist with development, debugging, architecture questions, or any other needs that come up with your React-based visual design tool.

      How are you doing today? Is there anything you'd like to work on with the project, or just checking in?"
      ,
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
              "timestamp": "2025-10-10T21:55:09.367Z",
              "toolName": "Task",
              "type": "tool-call",
            },
            {
              "id": "msg_01JkzQ7ZwMMMcKk3EY9X3sG1",
              "model": "claude-sonnet-4-5-20250929",
              "text": 
      "The user asked me to ask a subagent how they're doing, and I did that. The subagent responded politely saying they're doing well and ready to help. Now I should report back to the user with what the subagent said.

      This is just a casual/fun interaction, not a real task that needs a todo list, so I'll just respond normally."
      ,
              "timestamp": "2025-10-10T21:55:19.092Z",
              "type": "thinking",
            },
            {
              "id": "msg_01JkzQ7ZwMMMcKk3EY9X3sG1",
              "model": "claude-sonnet-4-5-20250929",
              "text": 
      "The subagent says they're doing well and ready to help! They mentioned they're functioning properly and prepared to assist with the Tailwind Studio project whenever needed. They even asked how I'm doing and if there's anything to work on. 

      Pretty friendly agent! 😊"
      ,
              "timestamp": "2025-10-10T21:55:20.440Z",
              "type": "agent",
            },
          ],
          "model": "anthropic/claude-sonnet-4-5-20250929",
          "modelUsage": [
            {
              "model": "anthropic/claude-sonnet-4-5-20250929",
              "usage": {
                "cachedInputTokens": 20952,
                "inputTokens": 31689,
                "outputTokens": 159,
                "reasoningOutputTokens": 0,
                "totalTokens": 31848,
              },
            },
          ],
          "preview": "ask a subagent how he's doing",
          "source": "claude-code",
          "summary": null,
          "timestamp": "2025-10-10T21:55:20.440Z",
          "tokenUsage": {
            "cachedInputTokens": 20952,
            "inputTokens": 31689,
            "outputTokens": 159,
            "reasoningOutputTokens": 0,
            "totalTokens": 31848,
          },
          "toolCount": 1,
          "userMessageCount": 1,
          "v": 1,
        },
      }
    `);
  });

  test("todos.jsonl", async () => {
    const serialized = await loadSerializedTranscript("todos.jsonl");
    expect(serialized.transcript.cwd).toBe(formatCwdWithTilde("/Users/philipp/dev/vibeinsights/fixtures/claudecode"));
    expect(serialized).toMatchInlineSnapshot(`
      {
        "blobs": {
          "count": 0,
          "sha256s": [],
        },
        "transcript": {
          "blendedTokens": 2835,
          "clientVersion": "2.0.14",
          "costUsd": 0.04278390000000001,
          "cwd": "~/dev/vibeinsights/fixtures/claudecode",
          "filesChanged": 0,
          "git": {
            "branch": "main",
            "relativeCwd": "fixtures/claudecode",
            "repo": "github.com/vibeinsights/vibeinsights",
          },
          "id": "0db46778-18a1-4d84-853f-d4dc72a07a1b",
          "linesAdded": 0,
          "linesModified": 0,
          "linesRemoved": 0,
          "messageCount": 12,
          "messages": [
            {
              "id": "a47984ff-069f-4c10-890c-d39fafb506c3",
              "text": "create a todo list with 3 items, then check off each step by step then clear it",
              "timestamp": "2025-10-12T21:40:29.471Z",
              "type": "user",
            },
            {
              "id": "msg_01PEHmYb3sgTVwcKVK8zZe9W",
              "model": "claude-sonnet-4-5-20250929",
              "text": "I'll create a todo list with 3 items, check them off step by step, and then clear it.",
              "timestamp": "2025-10-12T21:40:31.961Z",
              "type": "agent",
            },
            {
              "id": "msg_01PEHmYb3sgTVwcKVK8zZe9W",
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
              "timestamp": "2025-10-12T21:40:33.287Z",
              "toolName": "TodoWrite",
              "type": "tool-call",
            },
            {
              "id": "msg_01Vu4P668SsxMAEwR5XCS1HL",
              "model": "claude-sonnet-4-5-20250929",
              "text": "Now I'll mark the first task as in progress and complete it:",
              "timestamp": "2025-10-12T21:40:35.380Z",
              "type": "agent",
            },
            {
              "id": "msg_01Vu4P668SsxMAEwR5XCS1HL",
              "input": {
                "todos": [
                  {
                    "content": "Complete first task",
                    "status": "in_progress",
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
                    "status": "in_progress",
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
                "oldTodos": [
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
              "timestamp": "2025-10-12T21:40:36.183Z",
              "toolName": "TodoWrite",
              "type": "tool-call",
            },
            {
              "id": "msg_019ZRy9Jm6XbTSNxuXh1TKrD",
              "model": "claude-sonnet-4-5-20250929",
              "text": "First task completed! Now marking it as complete and moving to the second task:",
              "timestamp": "2025-10-12T21:40:38.412Z",
              "type": "agent",
            },
            {
              "id": "msg_019ZRy9Jm6XbTSNxuXh1TKrD",
              "input": {
                "todos": [
                  {
                    "content": "Complete first task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete second task",
                    "status": "in_progress",
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
                    "status": "completed",
                  },
                  {
                    "content": "Complete second task",
                    "status": "in_progress",
                  },
                  {
                    "content": "Complete third task",
                    "status": "pending",
                  },
                ],
                "oldTodos": [
                  {
                    "content": "Complete first task",
                    "status": "in_progress",
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
              "timestamp": "2025-10-12T21:40:39.199Z",
              "toolName": "TodoWrite",
              "type": "tool-call",
            },
            {
              "id": "msg_01PKiqSm8xTFuuCnZzES8GXg",
              "model": "claude-sonnet-4-5-20250929",
              "text": "Second task completed! Now marking it as complete and moving to the third task:",
              "timestamp": "2025-10-12T21:40:41.111Z",
              "type": "agent",
            },
            {
              "id": "msg_01PKiqSm8xTFuuCnZzES8GXg",
              "input": {
                "todos": [
                  {
                    "content": "Complete first task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete second task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete third task",
                    "status": "in_progress",
                  },
                ],
              },
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "newTodos": [
                  {
                    "content": "Complete first task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete second task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete third task",
                    "status": "in_progress",
                  },
                ],
                "oldTodos": [
                  {
                    "content": "Complete first task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete second task",
                    "status": "in_progress",
                  },
                  {
                    "content": "Complete third task",
                    "status": "pending",
                  },
                ],
              },
              "timestamp": "2025-10-12T21:40:42.127Z",
              "toolName": "TodoWrite",
              "type": "tool-call",
            },
            {
              "id": "msg_01KeSAsHmMR8QU3JUWvwDt4i",
              "model": "claude-sonnet-4-5-20250929",
              "text": "Third task completed! Now marking it as complete:",
              "timestamp": "2025-10-12T21:40:44.965Z",
              "type": "agent",
            },
            {
              "id": "msg_01KeSAsHmMR8QU3JUWvwDt4i",
              "input": {
                "todos": [
                  {
                    "content": "Complete first task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete second task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete third task",
                    "status": "completed",
                  },
                ],
              },
              "model": "claude-sonnet-4-5-20250929",
              "output": {
                "newTodos": [
                  {
                    "content": "Complete first task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete second task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete third task",
                    "status": "completed",
                  },
                ],
                "oldTodos": [
                  {
                    "content": "Complete first task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete second task",
                    "status": "completed",
                  },
                  {
                    "content": "Complete third task",
                    "status": "in_progress",
                  },
                ],
              },
              "timestamp": "2025-10-12T21:40:45.554Z",
              "toolName": "TodoWrite",
              "type": "tool-call",
            },
            {
              "id": "msg_01RVE2vyejpWb4hWtVSvjdxD",
              "model": "claude-sonnet-4-5-20250929",
              "text": "Done! I've created a todo list with 3 items, checked off each one step by step, and now the list has been automatically cleared since all items are completed.",
              "timestamp": "2025-10-12T21:40:49.323Z",
              "type": "agent",
            },
          ],
          "model": "anthropic/claude-sonnet-4-5-20250929",
          "modelUsage": [
            {
              "model": "anthropic/claude-sonnet-4-5-20250929",
              "usage": {
                "cachedInputTokens": 87863,
                "inputTokens": 90038,
                "outputTokens": 660,
                "reasoningOutputTokens": 0,
                "totalTokens": 90698,
              },
            },
          ],
          "preview": "create a todo list with 3 items, then check off each step by step then clear it",
          "source": "claude-code",
          "summary": null,
          "timestamp": "2025-10-12T21:40:49.323Z",
          "tokenUsage": {
            "cachedInputTokens": 87863,
            "inputTokens": 90038,
            "outputTokens": 660,
            "reasoningOutputTokens": 0,
            "totalTokens": 90698,
          },
          "toolCount": 5,
          "userMessageCount": 1,
          "v": 1,
        },
      }
    `);
  });

  test("images.jsonl", async () => {
    const serialized = await loadSerializedTranscript("images.jsonl");
    expect(serialized.transcript.cwd).toBe(formatCwdWithTilde("/Users/philipp/dev/vibeinsights"));
    expect(serialized).toMatchInlineSnapshot(`
      {
        "blobs": {
          "count": 1,
          "sha256s": [
            "13aed6cfe60716c6fc987f11f73b8e200937a08fd927f69836d4a99665694e00",
          ],
        },
        "transcript": {
          "blendedTokens": 6098,
          "clientVersion": "2.1.3",
          "costUsd": 0,
          "cwd": "~/dev/vibeinsights",
          "filesChanged": 0,
          "git": null,
          "id": "794b4c5f-6354-422a-9e6d-c9f18e89e427",
          "linesAdded": 0,
          "linesModified": 0,
          "linesRemoved": 0,
          "messageCount": 8,
          "messages": [
            {
              "id": "c3e4d9d7-4c50-4d9e-8a52-58d49da172c6",
              "text": "go to google.com, make a screenshoot, look at it, and tell me what you think",
              "timestamp": "2026-01-10T15:02:23.149Z",
              "type": "user",
            },
            {
              "id": "msg_011FE3TM4yUkN8pESjJZSaoj",
              "model": "claude-opus-4-5-20251101",
              "text": "The user wants me to navigate to google.com, take a screenshot, look at it, and share my thoughts. I'll use the browser automation tools to do this.",
              "timestamp": "2026-01-10T15:02:27.338Z",
              "type": "thinking",
            },
            {
              "id": "msg_011FE3TM4yUkN8pESjJZSaoj",
              "model": "claude-opus-4-5-20251101",
              "text": "I'll navigate to Google, take a screenshot, and share my thoughts.",
              "timestamp": "2026-01-10T15:02:28.625Z",
              "type": "agent",
            },
            {
              "id": "msg_011FE3TM4yUkN8pESjJZSaoj",
              "input": {
                "type": "url",
                "url": "https://www.google.com",
              },
              "model": "claude-opus-4-5-20251101",
              "output": [
                {
                  "text": 
      "# navigate_page response
      Successfully navigated to https://www.google.com.
      ## Pages
      0: https://www.google.com/ [selected]"
      ,
                  "type": "text",
                },
              ],
              "timestamp": "2026-01-10T15:02:28.985Z",
              "toolName": "mcp__chrome-devtools__navigate_page",
              "type": "tool-call",
            },
            {
              "id": "msg_01GdcnSwUkXNbiDskvwoAAug",
              "model": "claude-opus-4-5-20251101",
              "text": "Good, I've navigated to Google. Now let me take a screenshot.",
              "timestamp": "2026-01-10T15:02:33.797Z",
              "type": "thinking",
            },
            {
              "id": "msg_01GdcnSwUkXNbiDskvwoAAug",
              "images": [
                {
                  "mediaType": "image/png",
                  "sha256": "13aed6cfe60716c6fc987f11f73b8e200937a08fd927f69836d4a99665694e00",
                },
              ],
              "input": {},
              "model": "claude-opus-4-5-20251101",
              "output": [
                {
                  "text": 
      "# take_screenshot response
      Took a screenshot of the current page's viewport."
      ,
                  "type": "text",
                },
                {
                  "source": {
                    "mediaType": "image/png",
                    "sha256": "13aed6cfe60716c6fc987f11f73b8e200937a08fd927f69836d4a99665694e00",
                    "type": "sha256",
                  },
                  "type": "image",
                },
              ],
              "timestamp": "2026-01-10T15:02:33.846Z",
              "toolName": "mcp__chrome-devtools__take_screenshot",
              "type": "tool-call",
            },
            {
              "id": "msg_01BWjSuuueZQ9qVSjDCLKe7A",
              "model": "claude-opus-4-5-20251101",
              "text": "I can see the Google homepage with a consent/settings dialog in German. Let me share my thoughts about what I see.",
              "timestamp": "2026-01-10T15:02:37.795Z",
              "type": "thinking",
            },
            {
              "id": "msg_01BWjSuuueZQ9qVSjDCLKe7A",
              "model": "claude-opus-4-5-20251101",
              "text": 
      "Here's what I see:

      **Google's homepage** is displayed, but there's a modal dialog in the foreground. The page is in **German** (detected location: Austria/Österreich).

      The modal says **"Deine Einstellungen prüfen"** (Check your settings) - this is Google's privacy/consent dialog that appears for European users due to GDPR requirements. It explains:

      - Google has changed some settings because it couldn't verify you're over 18
      - SafeSearch filters explicit results
      - Personalized ads in Google Search are not available

      There are two buttons: **"Anpassen"** (Customize) and **"OK"** (Accept).

      **My thoughts:**
      - Classic minimalist Google design - white background, colorful logo, clean search bar (partially visible behind the modal)
      - The privacy consent flow is a necessary but somewhat intrusive UX pattern that European users see frequently
      - The footer shows a climate-related message: "Drei Jahrzehnte Klimaschutz: Jede Entscheidung zählt" (Three decades of climate protection: Every decision counts)
      - The dark overlay effect behind the modal is a standard UX pattern to focus attention on the dialog

      Would you like me to dismiss the dialog and show you the full homepage?"
      ,
              "timestamp": "2026-01-10T15:02:44.960Z",
              "type": "agent",
            },
          ],
          "model": "anthropic/claude-opus-4-5-20251101",
          "modelUsage": [
            {
              "model": "anthropic/claude-opus-4-5-20251101",
              "usage": {
                "cachedInputTokens": 67843,
                "inputTokens": 73796,
                "outputTokens": 145,
                "reasoningOutputTokens": 0,
                "totalTokens": 73941,
              },
            },
          ],
          "preview": "go to google.com, make a screenshoot, look at it, and tell me what you think",
          "source": "claude-code",
          "summary": null,
          "timestamp": "2026-01-10T15:02:45.165Z",
          "tokenUsage": {
            "cachedInputTokens": 67843,
            "inputTokens": 73796,
            "outputTokens": 145,
            "reasoningOutputTokens": 0,
            "totalTokens": 73941,
          },
          "toolCount": 2,
          "userMessageCount": 1,
          "v": 1,
        },
      }
    `);
  });
});

async function loadSerializedTranscript(fileName: string) {
  const result = await convertClaudeCodeFile(path.join(FIXTURE_DIR, fileName), {
    pricing: TEST_PRICING,
    now: TEST_NOW,
    gitContext: FIXTURE_GIT_CONTEXTS[fileName] ?? null,
  });

  expect(result).not.toBeNull();
  return serializeResult(result!);
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

describe("convertClaudeCodeTranscript", () => {
  test("returns null when transcript contains only /clear command", () => {
    // This transcript only contains a /clear command which is filtered out
    const clearOnlyTranscript = [
      {
        type: "file-history-snapshot",
        messageId: "579fc9e2-9c82-4c23-9848-958df81221b6",
        snapshot: {
          messageId: "579fc9e2-9c82-4c23-9848-958df81221b6",
          trackedFileBackups: {},
          timestamp: "2026-02-05T13:18:17.672Z",
        },
        isSnapshotUpdate: false,
      },
      {
        parentUuid: null,
        isSidechain: false,
        userType: "external",
        cwd: "/Users/test/dev/project",
        sessionId: "05df7215-01ed-497b-ab23-01fae33a980f",
        version: "2.1.31",
        gitBranch: "main",
        type: "user",
        message: {
          role: "user",
          content:
            "<local-command-caveat>Caveat: The messages below were generated by the user while running local commands. DO NOT respond to these messages or otherwise consider them in your response unless the user explicitly asks you to.</local-command-caveat>",
        },
        isMeta: true,
        uuid: "472f48cc-0b60-4775-87e2-aa3921c03e03",
        timestamp: "2026-02-05T13:18:17.672Z",
      },
      {
        parentUuid: "472f48cc-0b60-4775-87e2-aa3921c03e03",
        isSidechain: false,
        userType: "external",
        cwd: "/Users/test/dev/project",
        sessionId: "05df7215-01ed-497b-ab23-01fae33a980f",
        version: "2.1.31",
        gitBranch: "main",
        type: "user",
        message: {
          role: "user",
          content:
            "<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>",
        },
        uuid: "579fc9e2-9c82-4c23-9848-958df81221b6",
        timestamp: "2026-02-05T13:18:17.664Z",
      },
      {
        parentUuid: "579fc9e2-9c82-4c23-9848-958df81221b6",
        isSidechain: false,
        userType: "external",
        cwd: "/Users/test/dev/project",
        sessionId: "05df7215-01ed-497b-ab23-01fae33a980f",
        version: "2.1.31",
        gitBranch: "main",
        type: "user",
        message: { role: "user", content: "<local-command-stdout></local-command-stdout>" },
        uuid: "f88f585f-f984-49c1-9719-bbc527c77ff8",
        timestamp: "2026-02-05T13:18:17.672Z",
      },
    ];

    const result = convertClaudeCodeTranscript(clearOnlyTranscript);
    expect(result).toBeNull();
  });

  test("returns null when transcript contains only meta messages", () => {
    const metaOnlyTranscript = [
      {
        parentUuid: null,
        isSidechain: false,
        cwd: "/Users/test/dev/project",
        sessionId: "test-session",
        version: "2.1.31",
        gitBranch: "main",
        type: "user",
        message: { role: "user", content: "Some content" },
        isMeta: true,
        uuid: "meta-message-1",
        timestamp: "2026-02-05T13:18:17.672Z",
      },
    ];

    const result = convertClaudeCodeTranscript(metaOnlyTranscript);
    expect(result).toBeNull();
  });

  test("includes queued steering prompts as user messages", () => {
    const transcript = [
      {
        parentUuid: null,
        isSidechain: false,
        cwd: "/Users/test/dev/project",
        sessionId: "test-session",
        version: "2.1.31",
        gitBranch: "main",
        type: "user",
        message: {
          role: "user",
          content: "Deploy it",
        },
        uuid: "user-1",
        timestamp: "2026-02-05T13:18:17.000Z",
      },
      {
        parentUuid: "user-1",
        isSidechain: false,
        cwd: "/Users/test/dev/project",
        sessionId: "test-session",
        version: "2.1.31",
        gitBranch: "main",
        type: "assistant",
        message: {
          id: "assistant-1",
          role: "assistant",
          model: "claude-sonnet-4-5-20250929",
          content: [
            {
              type: "tool_use",
              id: "tool-1",
              name: "Bash",
              input: { command: "deploy" },
            },
          ],
        },
        uuid: "assistant-record-1",
        timestamp: "2026-02-05T13:18:18.000Z",
      },
      {
        parentUuid: "assistant-record-1",
        isSidechain: false,
        cwd: "/Users/test/dev/project",
        sessionId: "test-session",
        version: "2.1.31",
        gitBranch: "main",
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "tool-1",
              content: "done",
              is_error: false,
            },
          ],
        },
        toolUseResult: {
          stdout: "done",
          stderr: "",
          interrupted: false,
          isImage: false,
          noOutputExpected: false,
        },
        uuid: "tool-result-1",
        timestamp: "2026-02-05T13:18:19.000Z",
      },
      {
        parentUuid: "tool-result-1",
        isSidechain: false,
        cwd: "/Users/test/dev/project",
        sessionId: "test-session",
        version: "2.1.31",
        gitBranch: "main",
        type: "attachment",
        attachment: {
          type: "queued_command",
          prompt: "if that's it, then redeploy, I rotated the secret and set the new one",
          commandMode: "prompt",
        },
        uuid: "queued-command-1",
        timestamp: "2026-02-05T13:18:19.001Z",
      },
      {
        parentUuid: "queued-command-1",
        isSidechain: false,
        cwd: "/Users/test/dev/project",
        sessionId: "test-session",
        version: "2.1.31",
        gitBranch: "main",
        type: "assistant",
        message: {
          id: "assistant-2",
          role: "assistant",
          model: "claude-sonnet-4-5-20250929",
          content: [
            {
              type: "text",
              text: "Redeploying now.",
            },
          ],
        },
        uuid: "assistant-record-2",
        timestamp: "2026-02-05T13:18:20.000Z",
      },
    ];

    const result = convertClaudeCodeTranscript(transcript);
    expect(result).not.toBeNull();
    expect(result?.transcript.userMessageCount).toBe(2);
    expect(result?.transcript.messages).toContainEqual(
      expect.objectContaining({
        type: "user",
        id: "queued-command-1",
        variant: "steering",
        text: "if that's it, then redeploy, I rotated the secret and set the new one",
      }),
    );
  });
});
