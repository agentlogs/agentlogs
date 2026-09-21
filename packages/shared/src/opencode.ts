import path from "node:path";
import {
  calculateTranscriptStats,
  type UnifiedGitContext,
  type UnifiedTokenUsage,
  type UnifiedTranscript,
  type UnifiedTranscriptMessage,
} from "./claudecode";
import { formatCwdWithTilde, relativizePaths } from "./paths";
import type { LiteLLMModelPricing } from "./pricing";
import {
  unifiedGitContextSchema,
  unifiedModelUsageSchema,
  unifiedTranscriptMessageSchema,
  unifiedTranscriptSchema,
} from "./schemas";

// ============================================================================
// OpenCode Export Types (Real format from `opencode export`)
// ============================================================================

export type OpenCodeExport = {
  info: OpenCodeSessionInfo;
  messages: OpenCodeMessage[];
};

export type OpenCodeSessionInfo = {
  id: string;
  version?: string;
  projectID?: string;
  directory?: string;
  parentID?: string; // Set for subagent sessions
  title?: string;
  time: {
    created: number; // milliseconds since epoch
    updated?: number;
  };
  summary?: {
    additions?: number;
    deletions?: number;
    files?: number;
  };
};

export type OpenCodeMessage = {
  info: OpenCodeMessageInfo;
  parts: OpenCodePart[];
};

export type OpenCodeMessageInfo = {
  id: string;
  sessionID: string;
  role: "user" | "assistant";
  time: {
    created: number;
    completed?: number;
  };
  parentID?: string;
  modelID?: string;
  providerID?: string;
  mode?: string;
  agent?: string;
  path?: {
    cwd?: string;
    root?: string;
  };
  cost?: number;
  tokens?: {
    input: number;
    output: number;
    reasoning?: number;
    cache?: {
      read: number;
      write: number;
    };
  };
  finish?: string;
  summary?: {
    title?: string;
    diffs?: unknown[];
  };
  model?: {
    providerID?: string;
    modelID?: string;
  };
};

export type OpenCodeToolState = {
  status?: "pending" | "running" | "completed" | "error";
  input?: unknown;
  output?: unknown;
  error?: string;
  title?: string;
  metadata?: {
    diagnostics?: unknown;
    filepath?: string;
    exists?: boolean;
    truncated?: boolean;
    diff?: string;
    filediff?: {
      file?: string;
      before?: string;
      after?: string;
      additions?: number;
      deletions?: number;
    };
    // apply_patch tool uses files[] array
    files?: Array<{
      filePath?: string;
      relativePath?: string;
      type?: "add" | "update" | "delete";
      diff?: string;
      before?: string;
      after?: string;
      additions?: number;
      deletions?: number;
    }>;
    preview?: string;
    output?: string;
    exit?: number;
    description?: string;
    // Glob metadata
    count?: number;
    // Grep metadata
    matches?: number;
    // TodoWrite/TodoRead metadata
    todos?: Array<{
      id?: string;
      content?: string;
      status?: string;
      priority?: string;
    }>;
    // Skill metadata
    name?: string;
    dir?: string;
  };
  time?: {
    start?: number;
    end?: number;
  };
};

export type OpenCodePart =
  | { type: "text"; id?: string; text: string; time?: { start?: number; end?: number } }
  | {
      type: "tool";
      id?: string;
      callID: string;
      tool: string;
      state?: OpenCodeToolState;
      metadata?: unknown;
    }
  | { type: "reasoning"; id?: string; text: string; metadata?: unknown; time?: { start?: number; end?: number } }
  | { type: "step-start"; id?: string }
  | {
      type: "step-finish";
      id?: string;
      reason?: string;
      cost?: number;
      tokens?: { input: number; output: number; reasoning?: number; cache?: { read: number; write: number } };
    };

export type ConvertOpenCodeOptions = {
  now?: Date;
  gitContext?: UnifiedGitContext | null;
  cwd?: string | null;
  pricing?: Record<string, LiteLLMModelPricing>;
  clientVersion?: string;
};

// ============================================================================
// OpenCode V2 Export Types (OpenCode 2 server API, `SessionTransfer.Data`)
// ============================================================================
// OpenCode 2 replaced the `opencode export` CLI subcommand with the HTTP
// endpoint `GET /api/experimental/session/{sessionID}/export`. Its payload
// schema differs from the legacy export, so we normalize it into the legacy
// `OpenCodeExport` shape before conversion.

export type OpenCodeV2Export = {
  info: OpenCodeV2SessionInfo;
  messages: OpenCodeV2Message[];
};

export type OpenCodeV2TokenUsage = {
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: {
    read?: number;
    write?: number;
  };
};

export type OpenCodeV2SessionInfo = {
  id: string;
  parentID?: string;
  projectID?: string;
  agent?: string;
  model?: OpenCodeV2ModelRef;
  cost?: number;
  tokens?: OpenCodeV2TokenUsage;
  time: {
    created: number;
    updated?: number;
  };
  title?: string;
  location?: {
    directory?: string;
  };
  metadata?: Record<string, unknown>;
};

export type OpenCodeV2ModelRef = {
  id?: string;
  providerID?: string;
  variant?: string;
};

export type OpenCodeV2ToolContent =
  | { type: "text"; text?: string }
  | { type: "file"; uri?: string; mime?: string; name?: string };

export type OpenCodeV2ToolState = {
  status?: "streaming" | "running" | "completed" | "error";
  input?: unknown;
  content?: OpenCodeV2ToolContent[];
  metadata?: Record<string, unknown>;
  error?: unknown;
};

export type OpenCodeV2AssistantPart =
  | { type: "text"; text?: string }
  | {
      type: "reasoning";
      text?: string;
      metadata?: unknown;
      time?: { created?: number; completed?: number };
    }
  | {
      type: "tool";
      id?: string;
      name?: string;
      executed?: boolean;
      state?: OpenCodeV2ToolState;
      time?: { created?: number; ran?: number; completed?: number };
    };

export type OpenCodeV2UserMessage = {
  type: "user";
  id: string;
  time: { created: number };
  text?: string;
  files?: unknown[];
  agents?: unknown[];
  skills?: unknown[];
  metadata?: Record<string, unknown>;
};

export type OpenCodeV2AssistantMessage = {
  type: "assistant";
  id: string;
  time: { created: number; completed?: number; streamed?: number };
  agent?: string;
  model?: OpenCodeV2ModelRef;
  content: OpenCodeV2AssistantPart[];
  finish?: string;
  cost?: number;
  tokens?: OpenCodeV2TokenUsage;
  metadata?: Record<string, unknown>;
};

// Synthetic/system/control messages and any future message kinds. The type
// discriminant excludes the handled variants so that `type === "assistant"`
// (etc.) narrows to the concrete shapes instead of this fallback (whose index
// signature would otherwise swallow the known tags).
export type OpenCodeV2MessageType = "user" | "assistant";
export type OpenCodeV2OtherMessage = {
  type: Exclude<string, OpenCodeV2MessageType>;
  id?: string;
  time?: { created: number };
  text?: string;
  [key: string]: unknown;
};

export type OpenCodeV2Message = OpenCodeV2UserMessage | OpenCodeV2AssistantMessage | OpenCodeV2OtherMessage;

// ============================================================================
// Tool Name Mapping
// ============================================================================

const TOOL_NAME_MAP: Record<string, string> = {
  // OpenCode built-in tools → Unified names
  shell: "Bash",
  bash: "Bash",
  execute: "Bash",
  read_file: "Read",
  read: "Read",
  write_file: "Write",
  write: "Write",
  edit_file: "Edit",
  edit: "Edit",
  apply_patch: "Edit",
  multiedit: "Edit",
  glob: "Glob",
  grep: "Grep",
  find: "Glob",
  list_files: "Glob",
  ls: "Glob",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  task: "Task",
  explore: "Explore",
  skill: "Skill",
  todowrite: "TodoWrite",
  todoread: "TodoRead",
  question: "Question",
  plan: "Plan",
  codesearch: "CodeSearch",
  lsp: "LSP",
};

// ============================================================================
// Provider Prefixes for Pricing Lookup
// ============================================================================

const PROVIDER_PREFIXES = [
  "anthropic/",
  "claude-3-5-",
  "claude-3-",
  "claude-",
  "openai/",
  "azure/",
  "openrouter/",
  "google/",
  "gemini/",
];

const DEFAULT_TIERED_THRESHOLD = 200_000;

// ============================================================================
// Main Converter
// ============================================================================

/**
 * Convert an OpenCode export to a unified transcript.
 */
export function convertOpenCodeTranscript(
  data: OpenCodeExport,
  options: ConvertOpenCodeOptions = {},
): UnifiedTranscript | null {
  const { info, messages } = data;

  if (!messages || messages.length === 0) {
    return null;
  }

  const cwd = options.cwd ?? info.directory ?? null;
  const unifiedMessages: UnifiedTranscriptMessage[] = [];
  const userTexts: string[] = [];
  let primaryModel: string | null = null;
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalReasoningTokens = 0;
  let totalCacheReadTokens = 0;

  // Sort messages by creation time
  const sortedMessages = [...messages].sort((a, b) => {
    return a.info.time.created - b.info.time.created;
  });

  for (const message of sortedMessages) {
    const msgInfo = message.info;
    const model = computeModelIdentifier(msgInfo);

    // Track primary model from assistant messages
    if (msgInfo.role === "assistant" && model && !primaryModel) {
      primaryModel = model;
    }

    // Accumulate token usage from assistant messages
    if (msgInfo.role === "assistant" && msgInfo.tokens) {
      totalInputTokens += msgInfo.tokens.input ?? 0;
      totalOutputTokens += msgInfo.tokens.output ?? 0;
      totalReasoningTokens += msgInfo.tokens.reasoning ?? 0;
      totalCacheReadTokens += msgInfo.tokens.cache?.read ?? 0;
    }

    if (msgInfo.role === "assistant" && msgInfo.cost) {
      totalCost += msgInfo.cost;
    }

    for (const part of message.parts) {
      // Skip step-start and step-finish parts
      if (part.type === "step-start" || part.type === "step-finish") {
        continue;
      }

      const timestamp = new Date(msgInfo.time.created).toISOString();

      switch (part.type) {
        case "text": {
          const text = part.text?.trim();
          if (!text) break;

          if (msgInfo.role === "user") {
            userTexts.push(text);
            unifiedMessages.push(
              unifiedTranscriptMessageSchema.parse({
                type: "user",
                text,
                id: msgInfo.id,
                timestamp,
              }),
            );
          } else {
            unifiedMessages.push(
              unifiedTranscriptMessageSchema.parse({
                type: "agent",
                text,
                id: msgInfo.id,
                timestamp,
                model: model ?? undefined,
              }),
            );
          }
          break;
        }

        case "reasoning": {
          const text = part.text?.trim();
          if (!text) break;

          unifiedMessages.push(
            unifiedTranscriptMessageSchema.parse({
              type: "thinking",
              text,
              timestamp,
              model: model ?? undefined,
            }),
          );
          break;
        }

        case "tool": {
          const state = part.state ?? {};
          const input = state.input as Record<string, unknown> | undefined;

          // Skip TodoRead - it's redundant with TodoWrite
          if (part.tool === "todoread") {
            break;
          }

          // For Task tool with subagent_type, use the subagent type as the tool name
          let toolName = normalizeToolName(part.tool);
          if (toolName === "Task" && input?.subagent_type && typeof input.subagent_type === "string") {
            toolName = capitalizeToolName(input.subagent_type);
          }

          const sanitizedInput = sanitizeToolInput(toolName, state.input, cwd, state.metadata);
          const sanitizedOutput = sanitizeToolOutput(part.tool, toolName, state.output, state.metadata, cwd);

          unifiedMessages.push(
            unifiedTranscriptMessageSchema.parse({
              type: "tool-call",
              id: part.callID,
              timestamp,
              model: model ?? undefined,
              toolName,
              input: sanitizedInput,
              output: sanitizedOutput,
              error: state.error,
              isError: state.status === "error" || !!state.error,
            }),
          );
          break;
        }
      }
    }
  }

  if (unifiedMessages.length === 0) {
    return null;
  }

  // Build token usage
  const tokenUsage: UnifiedTokenUsage = {
    inputTokens: totalInputTokens,
    cachedInputTokens: totalCacheReadTokens,
    outputTokens: totalOutputTokens,
    reasoningOutputTokens: totalReasoningTokens,
    totalTokens: totalInputTokens + totalOutputTokens,
  };

  const blendedTokens = tokenUsage.inputTokens + tokenUsage.outputTokens;
  const costUsd = totalCost > 0 ? totalCost : calculateCostFromUsage(primaryModel, tokenUsage, options.pricing);

  const timestamp = new Date(info.time.created);
  const preview = derivePreview(userTexts);

  const gitContext =
    options.gitContext !== undefined
      ? options.gitContext
      : unifiedGitContextSchema.parse({
          repo: null,
          branch: null,
          relativeCwd: extractRelativeCwd(sortedMessages),
        });

  const formattedCwd = cwd ? formatCwdWithTilde(cwd) : null;
  const stats = calculateTranscriptStats(unifiedMessages);

  const transcript: UnifiedTranscript = unifiedTranscriptSchema.parse({
    v: 1 as const,
    id: info.id,
    source: "opencode" as const,
    timestamp,
    preview,
    summary: info.title && !info.title.startsWith("New session - ") ? info.title : null,
    model: primaryModel,
    clientVersion: options.clientVersion ?? info.version ?? null,
    blendedTokens,
    costUsd,
    messageCount: unifiedMessages.length,
    ...stats,
    tokenUsage,
    modelUsage: primaryModel
      ? [
          unifiedModelUsageSchema.parse({
            model: primaryModel,
            usage: tokenUsage,
          }),
        ]
      : [],
    git: gitContext,
    cwd: formattedCwd,
    messages: unifiedMessages,
  });

  return transcript;
}

// ============================================================================
// V2 Export Normalization
// ============================================================================

/**
 * Map an OpenCode 2 session export (`SessionTransfer.Data`) to the legacy
 * `OpenCodeExport` shape consumed by {@link convertOpenCodeTranscript}.
 *
 * OpenCode 2 messages use tagged unions instead of { info, parts }: user
 * messages carry their text directly, assistant messages embed tool calls in
 * `content`, and tool results live in tool `state`. Control and synthetic
 * messages (instructions, agent/model switches, compaction, shell records)
 * are not part of the transcript and are dropped.
 */
export function mapOpenCodeV2Export(data: OpenCodeV2Export): OpenCodeExport {
  const info: OpenCodeSessionInfo = {
    id: data.info.id,
    parentID: data.info.parentID,
    title: data.info.title,
    directory: data.info.location?.directory,
    time: {
      created: data.info.time?.created ?? Date.now(),
      updated: data.info.time?.updated,
    },
  };

  const messages: OpenCodeMessage[] = [];
  for (const message of data.messages ?? []) {
    const mapped = mapOpenCodeV2Message(message, data.info.id);
    if (mapped) messages.push(mapped);
  }

  return { info, messages };
}

function mapOpenCodeV2Message(message: OpenCodeV2Message, sessionID: string): OpenCodeMessage | null {
  if (message.type === "user") {
    const user = message as OpenCodeV2UserMessage;
    const text = user.text?.trim();
    if (!text) return null;
    return {
      info: {
        id: user.id,
        sessionID,
        role: "user",
        time: { created: user.time?.created ?? 0 },
      },
      parts: [{ type: "text", text }],
    };
  }

  if (message.type === "assistant") {
    const assistant = message as OpenCodeV2AssistantMessage;
    const parts: OpenCodePart[] = [];
    for (const part of assistant.content ?? []) {
      const mapped = mapOpenCodeV2AssistantPart(part);
      if (mapped) parts.push(mapped);
    }
    if (parts.length === 0) return null;

    return {
      info: {
        id: assistant.id,
        sessionID,
        role: "assistant",
        time: { created: assistant.time?.created ?? 0, completed: assistant.time?.completed },
        modelID: assistant.model?.id,
        providerID: assistant.model?.providerID,
        model: {
          providerID: assistant.model?.providerID,
          modelID: assistant.model?.id,
        },
        cost: assistant.cost,
        tokens: assistant.tokens
          ? {
              input: assistant.tokens.input ?? 0,
              output: assistant.tokens.output ?? 0,
              reasoning: assistant.tokens.reasoning,
              cache: assistant.tokens.cache
                ? {
                    read: assistant.tokens.cache.read ?? 0,
                    write: assistant.tokens.cache.write ?? 0,
                  }
                : undefined,
            }
          : undefined,
        finish: assistant.finish,
      },
      parts,
    };
  }

  // Synthetic, system, and control message kinds carry no transcript content
  // (AGENTS.md instructions, model/agent switches, compaction records, etc.).
  // Dropping them prevents system noise from polluting previews and timelines.
  return null;
}

function mapOpenCodeV2AssistantPart(part: OpenCodeV2AssistantPart): OpenCodePart | null {
  if (part.type === "text") {
    const text = part.text?.trim();
    if (!text) return null;
    return { type: "text", text };
  }

  if (part.type === "reasoning") {
    const text = part.text?.trim();
    if (!text) return null;
    return { type: "reasoning", text };
  }

  if (part.type === "tool") {
    const state = part.state ?? {};
    const toolName = part.name ?? "unknown";
    const output = v2ContentToString(state.content);
    const metadata: OpenCodeToolState["metadata"] = state.metadata ? { ...state.metadata } : {};

    // OpenCode 2's shell tool stores the command output in `state.content`
    // text parts. The unified Bash sanitization reads it from
    // metadata.output, so mirror it there (exit is already in metadata).
    if (isBashToolName(toolName) && output) {
      metadata.output = output;
    }

    const normalizedState: OpenCodeToolState = {
      status: state.status === "error" ? "error" : state.status === "completed" ? "completed" : undefined,
      input: state.input,
      output: output || undefined,
      error: state.error === undefined ? undefined : extractErrorMessage(state.error),
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      time: part.time
        ? {
            start: part.time.created,
            end: part.time.completed,
          }
        : undefined,
    };

    return {
      type: "tool",
      callID: part.id ?? "",
      tool: toolName,
      state: normalizedState,
    };
  }

  return null;
}

function v2ContentToString(content: OpenCodeV2ToolContent[] | undefined): string {
  if (!content) return "";
  return content
    .filter((part): part is { type: "text"; text?: string } => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n");
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && "message" in error) {
    const { message } = error as { message?: unknown };
    if (typeof message === "string") return message;
  }
  return "Tool failed";
}

function isBashToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "bash" || lower === "shell" || lower === "execute";
}

// ============================================================================
// Helper Functions
// ============================================================================

function normalizeToolName(name: string): string {
  const lower = name.toLowerCase();
  return TOOL_NAME_MAP[lower] ?? name;
}

function capitalizeToolName(name: string): string {
  // Check if already in the map
  const lower = name.toLowerCase();
  if (TOOL_NAME_MAP[lower]) {
    return TOOL_NAME_MAP[lower];
  }
  // Capitalize first letter
  return name.charAt(0).toUpperCase() + name.slice(1);
}

/**
 * Compute the model identifier from message info.
 * Returns `${providerID}/${modelID}` when both are available.
 */
function computeModelIdentifier(msgInfo: OpenCodeMessageInfo): string | null {
  const modelID = msgInfo.modelID ?? msgInfo.model?.modelID;
  const providerID = msgInfo.providerID ?? msgInfo.model?.providerID;

  if (!modelID) return null;
  if (providerID) return `${providerID}/${modelID}`;
  return modelID;
}

/**
 * Extract relativeCwd from OpenCode message path data.
 * Computes the relative path from root (git worktree) to cwd.
 */
function extractRelativeCwd(messages: OpenCodeMessage[]): string | null {
  // Find the first message with path info
  for (const message of messages) {
    const msgPath = message.info.path;
    if (msgPath?.root && msgPath?.cwd) {
      if (msgPath.root === msgPath.cwd) {
        return null; // At root, no relative path
      }
      try {
        const relative = path.relative(msgPath.root, msgPath.cwd).replace(/\\/g, "/");
        if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
          return relative;
        }
      } catch {
        // Ignore errors
      }
    }
  }

  return null;
}

function derivePreview(userTexts: string[]): string | null {
  for (const text of userTexts) {
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    // Skip system-like messages
    if (trimmed.startsWith("<") && trimmed.includes(">")) continue;
    // Remove surrounding quotes if present
    const unquoted = trimmed.replace(/^["']|["']$/g, "");
    return unquoted;
  }
  return userTexts.length > 0 ? userTexts[0].trim().replace(/\s+/g, " ") : null;
}

// ============================================================================
// Tool Input/Output Sanitization
// ============================================================================

/**
 * Strip the <file>...</file> wrapper and line numbers from Read output.
 */
function stripFileWrapper(output: string): string {
  let content = output;

  // Remove <file> wrapper
  const fileMatch = content.match(/<file>\n?([\s\S]*?)\n?<\/file>/);
  if (fileMatch) {
    content = fileMatch[1];
  }

  // Remove "(End of file - total N lines)" footer
  content = content.replace(/\n?\(End of file - total \d+ lines\)\n?$/, "");

  // Remove line numbers (format: "00001| content")
  const lines = content.split("\n");
  const strippedLines = lines.map((line) => {
    const match = line.match(/^\d+\| (.*)$/);
    return match ? match[1] : line;
  });

  return strippedLines.join("\n");
}

/**
 * Strip the unified diff header (Index, ===, ---, +++) and keep only the hunks.
 * The header is redundant since we already have file_path and type separately.
 */
function stripUnifiedDiffHeader(diff: string | undefined): string | undefined {
  if (!diff) return diff;

  const lines = diff.split("\n");
  const resultLines: string[] = [];
  let inHunk = false;

  for (const line of lines) {
    // Skip header lines
    if (line.startsWith("Index: ") || line.startsWith("===") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      continue;
    }
    // Start capturing from @@ hunk headers
    if (line.startsWith("@@")) {
      inHunk = true;
      continue; // Skip the @@ line itself too since it's metadata
    }
    if (inHunk) {
      resultLines.push(line);
    }
  }

  return resultLines.join("\n").trim() || undefined;
}

function sanitizeToolInput(
  toolName: string,
  input: unknown,
  cwd: string | null,
  metadata?: OpenCodeToolState["metadata"],
): unknown {
  if (!input || typeof input !== "object") return input;

  const record = { ...(input as Record<string, unknown>) };

  // Handle apply_patch: extract file info and diff from metadata
  // The diff represents what the agent is requesting to do (input), not the result
  if (toolName === "Edit" && typeof record.patchText === "string" && metadata?.files) {
    const files = metadata.files;
    if (files.length === 1) {
      // Single file edit - include the diff in input
      const file = files[0];
      const filePath = file.relativePath ?? (cwd && file.filePath ? relativizePath(file.filePath, cwd) : file.filePath);
      return {
        file_path: filePath,
        diff: stripUnifiedDiffHeader(file.diff),
        type: file.type,
      };
    } else if (files.length > 1) {
      // Multiple files - list them with diffs
      return {
        files: files.map((f) => ({
          file_path: f.relativePath ?? (cwd && f.filePath ? relativizePath(f.filePath, cwd) : f.filePath),
          type: f.type,
          diff: stripUnifiedDiffHeader(f.diff),
        })),
      };
    }
  }

  // Normalize filePath → file_path (OpenCode uses camelCase, unified format uses snake_case)
  if (typeof record.filePath === "string") {
    record.file_path = cwd ? relativizePath(record.filePath, cwd) : record.filePath;
    delete record.filePath;
  } else if (typeof record.file_path === "string" && cwd) {
    record.file_path = relativizePath(record.file_path, cwd);
  }

  // Normalize include → glob for Grep (Claude Code uses 'glob')
  if (toolName === "Grep" && typeof record.include === "string") {
    record.glob = record.include;
    delete record.include;
  }

  // Relativize path fields but rename 'path' to remove it (we show pattern for Glob/Grep)
  if ((toolName === "Glob" || toolName === "Grep") && typeof record.path === "string") {
    // Remove the path field - it's redundant with cwd context
    delete record.path;
  } else if (typeof record.path === "string" && cwd) {
    record.path = relativizePath(record.path, cwd);
  }

  if (typeof record.workdir === "string" && cwd) {
    record.workdir = relativizePath(record.workdir, cwd);
  }

  // Apply generic path relativization to catch any missed paths
  return cwd ? relativizePaths(record, cwd) : record;
}

function sanitizeToolOutput(
  originalToolName: string,
  normalizedToolName: string,
  output: unknown,
  metadata: OpenCodeToolState["metadata"],
  cwd: string | null,
): unknown {
  let result: unknown = output;

  // For Bash, extract from metadata
  if (normalizedToolName === "Bash" && metadata) {
    const bashResult: Record<string, unknown> = {};
    if (typeof metadata.output === "string") {
      bashResult.stdout = metadata.output;
    }
    if (typeof metadata.exit === "number") {
      bashResult.exitCode = metadata.exit;
    }
    if (typeof metadata.description === "string") {
      bashResult.description = metadata.description;
    }
    result = Object.keys(bashResult).length > 0 ? bashResult : output;
  }

  // For Read, format as Claude Code expects: { file: { filePath, content, numLines, ... } }
  else if (normalizedToolName === "Read") {
    const content = metadata?.preview ?? (typeof output === "string" ? stripFileWrapper(output) : null);
    if (content) {
      const numLines = content.split("\n").length;
      result = {
        file: {
          content,
          numLines,
          totalLines: numLines,
        },
      };
    }
  }

  // For Glob, format as Claude Code expects: { filenames: [...], numFiles }
  else if (normalizedToolName === "Glob") {
    const outputStr = typeof output === "string" ? output : "";
    const filenames = outputStr
      .split("\n")
      .map((f) => f.trim())
      .filter(Boolean)
      .map((f) => (cwd ? relativizePath(f, cwd) : f));
    result = {
      filenames,
      numFiles: metadata?.count ?? filenames.length,
    };
  }

  // For Grep, format as Claude Code expects: { mode, content/filenames, numLines/numFiles }
  else if (normalizedToolName === "Grep") {
    const outputStr = typeof output === "string" ? output : "";
    // Parse the output - it starts with "Found X matches" then lists files
    const lines = outputStr.split("\n");
    const matchCount = metadata?.matches ?? 0;

    // Extract the actual content lines (skip the "Found X matches" header)
    const contentLines = lines.slice(1).filter((l) => l.trim());

    result = {
      mode: "content",
      content: contentLines.join("\n"),
      numMatches: matchCount,
      numLines: contentLines.length,
    };
  }

  // For apply_patch (mapped to Edit), just show success and stats (diff is in input)
  else if (originalToolName === "apply_patch" && metadata?.files) {
    const files = metadata.files;
    if (files.length === 1) {
      const file = files[0];
      result = {
        additions: file.additions,
        deletions: file.deletions,
      };
    } else {
      result = {
        files: files.map((f) => ({
          file_path: f.relativePath ?? (cwd && f.filePath ? relativizePath(f.filePath, cwd) : f.filePath),
          additions: f.additions,
          deletions: f.deletions,
        })),
      };
    }
  }

  // For Edit, extract diff from metadata
  else if (normalizedToolName === "Edit" && metadata?.filediff) {
    result = {
      diff: metadata.diff,
      additions: metadata.filediff.additions,
      deletions: metadata.filediff.deletions,
    };
  }

  // For Write, check if file existed
  else if (normalizedToolName === "Write" && metadata) {
    result = { created: !metadata.exists };
  }

  // For Explore (Task subagent), clean up the output by removing task metadata
  else if (normalizedToolName === "Explore") {
    const outputStr = typeof output === "string" ? output : "";
    // Remove <task_metadata>...</task_metadata> section
    const cleanOutput = outputStr.replace(/<task_metadata>[\s\S]*?<\/task_metadata>/g, "").trim();
    result = { content: cleanOutput };
  }

  // For Skill, format as markdown content
  else if (normalizedToolName === "Skill") {
    const outputStr = typeof output === "string" ? output : "";
    result = { content: outputStr };
  }

  // For WebFetch, format as markdown content
  else if (normalizedToolName === "WebFetch") {
    const outputStr = typeof output === "string" ? output : "";
    result = { content: outputStr };
  }

  // For TodoWrite/TodoRead, extract todos from metadata or parse output
  else if (normalizedToolName === "TodoWrite" || normalizedToolName === "TodoRead") {
    const todos = metadata?.todos ?? [];
    result = { todos };
  }

  // Apply generic path relativization to catch any missed paths
  return cwd ? relativizePaths(result, cwd) : result;
}

function relativizePath(target: string, cwd: string): string {
  if (!target) return target;

  const isAbsolutePath = path.isAbsolute(target);
  const normalizedTarget = target.replace(/\\/g, "/");

  if (!isAbsolutePath) {
    if (normalizedTarget === "." || normalizedTarget === "./") return ".";
    if (normalizedTarget.startsWith("./") || normalizedTarget.startsWith("../")) {
      return normalizedTarget;
    }
    return `./${normalizedTarget}`;
  }

  try {
    const relative = path.relative(cwd, target).replace(/\\/g, "/");
    if (relative === "") return ".";
    if (relative.startsWith("..") || path.isAbsolute(relative)) return target;
    return relative === "." ? "." : `./${relative}`;
  } catch {
    return target;
  }
}

// ============================================================================
// Cost Calculation
// ============================================================================

function calculateCostFromUsage(
  modelName: string | null,
  usage: UnifiedTokenUsage,
  pricingData: Record<string, LiteLLMModelPricing> | undefined,
): number {
  if (!pricingData || !modelName) return 0;

  const pricing = resolvePricingForModel(modelName, pricingData);
  if (!pricing) return 0;

  return calculateCostFromPricing(
    {
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: usage.cachedInputTokens,
    },
    pricing,
  );
}

function resolvePricingForModel(
  modelName: string,
  pricingData: Record<string, LiteLLMModelPricing>,
): LiteLLMModelPricing | null {
  const normalizedName = modelName.trim();
  if (!normalizedName) return null;

  const candidates = new Set<string>();
  candidates.add(normalizedName);
  for (const prefix of PROVIDER_PREFIXES) {
    candidates.add(`${prefix}${normalizedName}`);
  }

  for (const candidate of candidates) {
    const pricing = pricingData[candidate];
    if (pricing) return pricing;
  }

  const lower = normalizedName.toLowerCase();
  for (const [key, pricing] of Object.entries(pricingData)) {
    const comparison = key.toLowerCase();
    if (comparison.includes(lower) || lower.includes(comparison)) {
      return pricing;
    }
  }

  return null;
}

function calculateCostFromPricing(
  tokens: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  },
  pricing: LiteLLMModelPricing,
): number {
  const calculateTieredCost = (
    totalTokens: number | undefined,
    basePrice: number | undefined,
    tieredPrice: number | undefined,
    threshold: number = DEFAULT_TIERED_THRESHOLD,
  ) => {
    if (totalTokens == null || totalTokens <= 0) return 0;

    if (totalTokens > threshold && tieredPrice != null) {
      const tokensBelowThreshold = Math.min(totalTokens, threshold);
      const tokensAboveThreshold = Math.max(0, totalTokens - threshold);

      let tieredCost = tokensAboveThreshold * tieredPrice;
      if (basePrice != null) {
        tieredCost += tokensBelowThreshold * basePrice;
      }
      return tieredCost;
    }

    if (basePrice != null) {
      return totalTokens * basePrice;
    }

    return 0;
  };

  const inputCost = calculateTieredCost(
    tokens.input_tokens,
    pricing.input_cost_per_token,
    pricing.input_cost_per_token_above_200k_tokens,
  );

  const outputCost = calculateTieredCost(
    tokens.output_tokens,
    pricing.output_cost_per_token,
    pricing.output_cost_per_token_above_200k_tokens,
  );

  const cacheCreationCost = calculateTieredCost(
    tokens.cache_creation_input_tokens,
    pricing.cache_creation_input_token_cost,
    pricing.cache_creation_input_token_cost_above_200k_tokens,
  );

  const cacheReadCost = calculateTieredCost(
    tokens.cache_read_input_tokens,
    pricing.cache_read_input_token_cost,
    pricing.cache_read_input_token_cost_above_200k_tokens,
  );

  return inputCost + outputCost + cacheCreationCost + cacheReadCost;
}

// ============================================================================
// Exports
// ============================================================================

export type { UnifiedGitContext, UnifiedTokenUsage, UnifiedTranscript, UnifiedTranscriptMessage };
