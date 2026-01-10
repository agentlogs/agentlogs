# OpenCode Plugin Design Document

## Overview

Design an OpenCode plugin similar to the existing Claude Code plugin, enabling transcript capture, analysis, and upload to the vibeinsights platform.

## Background

### Current Claude Code Implementation

The existing Claude Code integration consists of:

1. **Hook Handler** (`packages/cli/src/commands/hook.ts`):
   - `PreToolUse`: Intercepts git commits, appends transcript links to commit messages
   - `SessionEnd`: Uploads full transcript when session completes
   - `Stop`: Uploads transcript when session is interrupted

2. **Transcript Converter** (`packages/shared/src/claudecode.ts`):
   - Parses JSONL transcript files
   - Builds message tree from parent-child UUIDs
   - Converts to unified transcript format
   - Sanitizes tool calls and extracts git context

3. **Upload Pipeline** (`packages/cli/src/lib/perform-upload.ts`):
   - Reads raw transcript file
   - Converts to unified format
   - Uploads to server with SHA256 hash

### OpenCode Architecture

OpenCode is fundamentally different from Claude Code:

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| **Data Format** | JSONL files in `~/.claude/projects/` | SQLite database in `~/.local/share/opencode/` |
| **Hook System** | 4 events via stdin JSON | 32+ events via JS/TS plugin |
| **Data Access** | File parsing | SDK API calls |
| **Runtime** | Shell hook (any language) | Bun/JavaScript |

---

## OpenCode Plugin System Analysis

### Available Hooks

Based on [OpenCode Plugin Documentation](https://opencode.ai/docs/plugins/):

**Session Events:**
- `session.created` - New session started
- `session.updated` - Session metadata changed
- `session.deleted` - Session removed
- `session.error` - Error occurred
- `session.idle` - Session completed/idle
- `session.compacted` - Context compaction occurred
- `session.diff` - Session diff available
- `session.status` - Status change

**Message Events:**
- `message.updated` - Message content changed
- `message.removed` - Message deleted
- `message.part.updated` - Message part updated
- `message.part.removed` - Message part removed

**Tool Events:**
- `tool.execute.before` - Before tool execution (can modify args)
- `tool.execute.after` - After tool execution (access results)

**Other Events:**
- `command.executed`, `file.edited`, `file.watcher.updated`
- `permission.replied`, `permission.updated`
- `tui.prompt.append`, `tui.command.execute`, `tui.toast.show`
- `lsp.client.diagnostics`, `lsp.updated`
- `installation.updated`, `todo.updated`, `server.connected`

### Data Structures

**Session (from SDK):**
```typescript
interface Session {
  id: string;
  parentSessionId: string | null;
  title: string;
  messageCount: number;
  promptTokens: number;
  completionTokens: number;
  summaryMessageId: string | null;
  cost: number;
  createdAt: Date;
  updatedAt: Date;
}
```

**Message (from SDK):**
```typescript
interface Message {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  parts: ContentPart[];
  model: string | null;
  createdAt: Date;
  updatedAt: Date;
  finishedAt: Date | null;
}
```

**Content Part Types:**
```typescript
type ContentPart =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; state: ToolState }
  | { type: "reasoning"; text: string }
  | { type: "file"; url: string; mime: string }
  | { type: "compaction"; summary: string };

interface ToolState {
  input?: unknown;
  output?: unknown;
  error?: string;
  status: "pending" | "running" | "completed" | "error";
}
```

### SDK Access

```typescript
import { createOpencodeClient } from "@opencode-ai/sdk";

const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });

// List sessions
const sessions = await client.session.list();

// Get specific session
const session = await client.session.get({ path: { id: sessionId } });

// List messages in session
const messages = await client.session.messages({ path: { id: sessionId } });
```

### Storage Location

- Unix: `~/.local/share/opencode/`
- Windows: `%USERPROFILE%\.local\share\opencode\`
- Per-project: `project/<project-id>/session/<session-id>/`

---

## Transcript Extraction Feasibility

### Can We Extract Transcripts?

**YES**, through two methods:

1. **SDK API Access** (Recommended):
   - Use `session.messages()` to fetch all messages for a session
   - Convert message parts to unified format
   - Available data: text, tool calls/results, reasoning, compaction summaries

2. **Direct Database Access** (Fallback):
   - Read SQLite database directly
   - Parse `parts` JSON column from messages table
   - More complex, less portable

### Data Available for Transcript

| Data Point | Availability | Source |
|------------|--------------|--------|
| Session ID | ✅ | Session.id |
| Timestamp | ✅ | Session.createdAt |
| User messages | ✅ | Message.parts (role=user) |
| Agent responses | ✅ | Message.parts (role=assistant) |
| Tool calls | ✅ | Message.parts (type=tool) |
| Tool results | ✅ | ToolState.output |
| Thinking/Reasoning | ✅ | Message.parts (type=reasoning) |
| Compaction summaries | ✅ | Message.parts (type=compaction) |
| Token usage | ✅ | Session.promptTokens + completionTokens |
| Cost | ✅ | Session.cost |
| Model | ✅ | Message.model |
| Git context | ⚠️ Partial | Plugin context.worktree |
| Working directory | ✅ | Plugin context.directory |

### Missing vs Claude Code

- **Branch/Repo**: Need to extract from git at plugin runtime (not stored in session)
- **Message UUIDs/Tree**: OpenCode uses flat message list, not tree structure
- **Cache tokens**: May not be exposed in SDK (need investigation)

---

## Implementation Plan

### Phase 1: OpenCode Transcript Converter

Create `packages/shared/src/opencode.ts`:

```typescript
export type OpenCodeSession = {
  id: string;
  title: string;
  promptTokens: number;
  completionTokens: number;
  cost: number;
  createdAt: string;
  updatedAt: string;
};

export type OpenCodeMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  parts: OpenCodePart[];
  model: string | null;
  createdAt: string;
  finishedAt: string | null;
};

export type OpenCodePart =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; input?: unknown; output?: unknown; error?: string }
  | { type: "reasoning"; text: string }
  | { type: "compaction"; summary: string }
  | { type: "file"; url: string; mime: string };

export type ConvertOpenCodeOptions = {
  now?: Date;
  gitContext?: UnifiedGitContext | null;
  pricing?: Record<string, LiteLLMModelPricing>;
};

export function convertOpenCodeTranscript(
  session: OpenCodeSession,
  messages: OpenCodeMessage[],
  options: ConvertOpenCodeOptions = {},
): UnifiedTranscript;
```

**Key Mapping:**

| OpenCode | Unified |
|----------|---------|
| `type: "text"` + role=user | `type: "user"` |
| `type: "text"` + role=assistant | `type: "agent"` |
| `type: "reasoning"` | `type: "thinking"` |
| `type: "tool"` | `type: "tool-call"` |
| `type: "compaction"` | `type: "compaction-summary"` |
| `type: "file"` (images) | `type: "image"` |

**Tool Name Normalization:**

OpenCode may use different tool names. Need to investigate and map:
- `shell` → `Bash`
- `read_file` → `Read`
- `write_file` → `Write`
- `edit_file` → `Edit`
- etc.

### Phase 2: OpenCode Plugin

Create `packages/cli/src/opencode-plugin/index.ts`:

```typescript
import type { Plugin } from "@opencode-ai/plugin";

export const vibeInsightsPlugin: Plugin = async (ctx) => {
  // State to track current session
  let currentSessionId: string | null = null;

  return {
    event: async (event) => {
      // Track session for later upload
      if (event.type === "session.created") {
        currentSessionId = event.session.id;
      }

      // Upload transcript when session becomes idle
      if (event.type === "session.idle" && currentSessionId) {
        await uploadTranscript(ctx, currentSessionId);
      }
    },

    // Intercept tool execution for git commit enhancement
    tool: {
      execute: {
        before: async (args) => {
          if (args.name === "shell" && isGitCommit(args.input)) {
            // Modify commit message to include transcript link
            return modifyCommitArgs(args, currentSessionId);
          }
          return args;
        },
      },
    },
  };
};
```

### Phase 3: Git Context Extraction

Since OpenCode doesn't store git context in sessions, extract at runtime:

```typescript
async function extractGitContext(ctx: PluginContext): Promise<UnifiedGitContext> {
  const worktree = ctx.worktree;

  if (!worktree) {
    return { repo: null, branch: null, relativeCwd: null };
  }

  // Use Bun shell to get git info
  const { stdout: branch } = await ctx.$`git -C ${worktree} rev-parse --abbrev-ref HEAD`;
  const { stdout: remote } = await ctx.$`git -C ${worktree} config --get remote.origin.url`;

  return {
    repo: parseRemoteUrl(remote.trim()),
    branch: branch.trim(),
    relativeCwd: path.relative(worktree, ctx.directory),
  };
}
```

### Phase 4: Upload Integration

Reuse existing upload infrastructure:

```typescript
async function uploadTranscript(ctx: PluginContext, sessionId: string) {
  // 1. Fetch session and messages via SDK
  const session = await ctx.client.session.get({ path: { id: sessionId } });
  const messagesResponse = await ctx.client.session.messages({ path: { id: sessionId } });

  // 2. Extract git context
  const gitContext = await extractGitContext(ctx);

  // 3. Convert to unified format
  const unified = convertOpenCodeTranscript(session.data, messagesResponse.data, {
    gitContext,
    pricing: await fetchPricing(),
  });

  // 4. Upload to server
  await uploadToServer(unified);
}
```

---

## Plugin Configuration

### Installation

Users would install via `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["@vibeinsights/opencode-plugin"]
}
```

Or local development:

```json
{
  "plugin": [".opencode/plugin/vibeinsights.ts"]
}
```

### Environment Variables

```bash
# Required
VIBEINSIGHTS_API_KEY=vi_xxxxxxxxxxxxx
# or
VIBEINSIGHTS_AUTH_TOKEN=xxxxxxxxxxxxx

# Optional
VIBEINSIGHTS_BASE_URL=https://vibeinsights.dev
```

### Package Structure

```
packages/
├── opencode-plugin/           # New package
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts          # Plugin entry point
│   │   ├── upload.ts         # Upload logic
│   │   └── git.ts            # Git context extraction
│   └── README.md
└── shared/
    └── src/
        └── opencode.ts        # Transcript converter
```

---

## Schema Updates

### Update `packages/shared/src/schemas.ts`

Add `"opencode"` as a valid source:

```typescript
export const unifiedTranscriptSchema = z.object({
  // ...
  source: z.enum(["claude-code", "codex", "opencode", "unknown"]),
  // ...
});
```

### Update Types

```typescript
export type TranscriptSource = "claude-code" | "codex" | "opencode" | "unknown";
```

---

## Key Differences from Claude Code Plugin

| Aspect | Claude Code | OpenCode |
|--------|-------------|----------|
| **Entry Point** | CLI hook command | JS plugin export |
| **Data Source** | Parse JSONL file | SDK API calls |
| **Transcript File** | `~/.claude/projects/*/transcripts/*.jsonl` | None (in-memory from API) |
| **Hook Trigger** | stdin JSON with hook_event_name | Event callback in plugin |
| **Git Commit Hook** | PreToolUse + modify tool_input | tool.execute.before + modify args |
| **Session End** | SessionEnd event | session.idle event |
| **Runtime** | Any (called via shell) | Bun/Node.js |

---

## Testing Strategy

### Unit Tests (`packages/shared/src/opencode.test.ts`)

```typescript
describe("convertOpenCodeTranscript", () => {
  it("converts user messages", () => { /* ... */ });
  it("converts agent messages with model", () => { /* ... */ });
  it("converts tool calls with input/output", () => { /* ... */ });
  it("converts reasoning to thinking", () => { /* ... */ });
  it("handles compaction summaries", () => { /* ... */ });
  it("calculates token usage correctly", () => { /* ... */ });
  it("extracts git context", () => { /* ... */ });
});
```

### Integration Tests

1. Mock OpenCode SDK responses
2. Test full conversion pipeline
3. Verify upload payload format

### E2E Tests

1. Install plugin in test OpenCode instance
2. Run session with tool use
3. Verify transcript uploaded correctly

---

## Implementation Checklist

### Converter (`packages/shared/src/opencode.ts`)
- [ ] Define OpenCode types (Session, Message, Part)
- [ ] Implement `convertOpenCodeTranscript()`
- [ ] Map tool names to unified format
- [ ] Extract token usage from session metadata
- [ ] Calculate costs using pricing data
- [ ] Build git context from plugin context
- [ ] Add unit tests

### Plugin (`packages/opencode-plugin/`)
- [ ] Create package with Bun config
- [ ] Implement plugin entry point
- [ ] Handle `session.idle` for upload
- [ ] Handle `tool.execute.before` for git commits
- [ ] Extract git context at runtime
- [ ] Add authentication handling
- [ ] Add error handling and logging
- [ ] Create README with installation instructions

### Schema Updates
- [ ] Add "opencode" to source enum
- [ ] Update TypeScript types
- [ ] Update upload validation

### Documentation
- [ ] User documentation for plugin installation
- [ ] API documentation for converter
- [ ] Migration guide from manual transcript import

---

## Open Questions

1. **Cache Token Tracking**: Does OpenCode expose cache token usage? Need to check SDK/API.

2. **Sub-agent Sessions**: How does OpenCode handle sub-agent/task sessions? Similar to Claude Code's parentUuid pattern?

3. **Session Compaction**: How to handle compaction summaries in transcript? Currently mapping to `compaction-summary` type.

4. **Tool Name Standardization**: Need comprehensive list of OpenCode tool names and their canonical mappings.

5. **Real-time Upload**: Should we upload partial transcripts on each message, or only on session.idle?

6. **Commit Message Format**: What's the best way to modify git commit messages via `tool.execute.before`?

---

## References

- [OpenCode Plugin Documentation](https://opencode.ai/docs/plugins/)
- [OpenCode SDK Documentation](https://opencode.ai/docs/sdk/)
- [@opencode-ai/sdk npm package](https://www.npmjs.com/package/@opencode-ai/sdk)
- [OpenCode GitHub Repository](https://github.com/opencode-ai/opencode)
- [Helicone Session Plugin Example](https://github.com/H2Shami/opencode-helicone-session)
- [Plugin Development Guide (Community)](https://gist.github.com/rstacruz/946d02757525c9a0f49b25e316fbe715)
