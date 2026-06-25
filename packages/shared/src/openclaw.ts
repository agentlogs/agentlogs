import {
  calculateTranscriptStats,
  type UnifiedGitContext,
  type UnifiedTokenUsage,
  type UnifiedTranscript,
  type UnifiedTranscriptMessage,
} from "./claudecode";
import { formatCwdWithTilde } from "./paths";
import type { LiteLLMModelPricing } from "./pricing";
import {
  unifiedGitContextSchema,
  unifiedModelUsageSchema,
  unifiedTranscriptMessageSchema,
  unifiedTranscriptSchema,
} from "./schemas";

// ============================================================================
// OpenClaw session log types (JSONL: one record per line)
// ============================================================================

export type OpenClawSessionRecord = {
  type: "session";
  id: string;
  version?: number;
  timestamp?: string;
  cwd?: string;
};

export type OpenClawContentBlock =
  | { type: "text"; text?: string }
  | { type: "thinking"; thinking?: string; thinkingSignature?: string }
  | { type: "toolCall"; id: string; name: string; arguments?: Record<string, unknown> };

export type OpenClawUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: { total?: number };
};

export type OpenClawInnerMessage = {
  role: "user" | "assistant" | "toolResult";
  content?: Array<OpenClawContentBlock | { type: string; text?: string }>;
  model?: string;
  provider?: string;
  api?: string;
  usage?: OpenClawUsage;
  stopReason?: string;
  // toolResult-only fields
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};

export type OpenClawMessageRecord = {
  type: "message";
  id?: string;
  parentId?: string;
  timestamp?: string;
  message: OpenClawInnerMessage;
};

export type OpenClawCompactionRecord = {
  type: "compaction";
  id?: string;
  timestamp?: string;
  summary?: string;
};

export type OpenClawRecord =
  | OpenClawSessionRecord
  | OpenClawMessageRecord
  | OpenClawCompactionRecord
  | { type?: string };

export type ConvertOpenClawOptions = {
  now?: Date;
  gitContext?: UnifiedGitContext | null;
  cwd?: string | null;
  pricing?: Record<string, LiteLLMModelPricing>;
  clientVersion?: string;
};

// OpenClaw tool names → unified canonical tool names. Tools without a mapping
// (browser, process, message, ...) keep a capitalized form and fall back to the
// generic tool renderer.
const TOOL_NAME_MAP: Record<string, string> = {
  read: "Read",
  write: "Write",
  bash: "Bash",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
};

// ============================================================================
// Converter
// ============================================================================

/**
 * Parse OpenClaw JSONL content into records, skipping malformed lines so a single
 * truncated/garbled line (common in live-written session backups) doesn't abort.
 */
export function parseOpenClawRecords(content: string): OpenClawRecord[] {
  const records: OpenClawRecord[] = [];
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line) as OpenClawRecord);
    } catch {
      // Skip malformed line.
    }
  }
  return records;
}

export function convertOpenClawTranscript(
  records: OpenClawRecord[],
  options: ConvertOpenClawOptions = {},
): UnifiedTranscript | null {
  const isRecord = (r: OpenClawRecord): r is OpenClawRecord => !!r && typeof r === "object";
  const session = records.find((r): r is OpenClawSessionRecord => isRecord(r) && r.type === "session") ?? null;
  const hasMessages = records.some((r) => isRecord(r) && r.type === "message");
  if (!session && !hasMessages) {
    return null;
  }

  const cwd = options.cwd ?? session?.cwd ?? null;

  // Build messages as plain objects so a later toolResult can attach its output
  // to the originating tool-call before final schema validation.
  const rawMessages: Record<string, unknown>[] = [];
  const toolCallIndexById = new Map<string, number>();
  const userTexts: string[] = [];

  let primaryModel: string | null = null;
  let totalCost = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheReadTokens = 0;

  for (const record of records) {
    if (!record || typeof record !== "object") continue;
    if (record.type === "compaction") {
      const summary = (record as OpenClawCompactionRecord).summary?.trim();
      if (summary) {
        rawMessages.push({
          type: "compaction-summary",
          text: summary,
          id: (record as OpenClawCompactionRecord).id,
          timestamp: (record as OpenClawCompactionRecord).timestamp,
        });
      }
      continue;
    }

    if (record.type !== "message") {
      continue;
    }

    const msg = (record as OpenClawMessageRecord).message;
    if (!msg || typeof msg !== "object") continue;
    const timestamp = (record as OpenClawMessageRecord).timestamp;
    const recordId = (record as OpenClawMessageRecord).id;
    // Tolerate malformed records: content may be missing or not an array.
    const content = Array.isArray(msg.content) ? msg.content : [];

    if (msg.role === "user") {
      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          const text = block.text.trim();
          userTexts.push(text);
          rawMessages.push({ type: "user", text, id: recordId, timestamp });
        }
      }
      continue;
    }

    if (msg.role === "assistant") {
      const model = msg.model ?? null;
      if (model && !primaryModel) {
        primaryModel = model;
      }
      if (msg.usage) {
        totalInputTokens += msg.usage.input ?? 0;
        totalOutputTokens += msg.usage.output ?? 0;
        totalCacheReadTokens += msg.usage.cacheRead ?? 0;
        totalCost += msg.usage.cost?.total ?? 0;
      }

      for (const block of content) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "thinking") {
          const text = (block as { thinking?: string }).thinking?.trim();
          if (text) {
            rawMessages.push({ type: "thinking", text, timestamp, model: model ?? undefined });
          }
        } else if (block.type === "text") {
          const text = block.text?.trim();
          if (text) {
            rawMessages.push({ type: "agent", text, id: recordId, timestamp, model: model ?? undefined });
          }
        } else if (block.type === "toolCall") {
          const call = block as { id?: string; name?: string; arguments?: Record<string, unknown> };
          const name = typeof call.name === "string" ? call.name : "tool";
          const toolName = normalizeToolName(name);
          if (typeof call.id === "string") {
            toolCallIndexById.set(call.id, rawMessages.length);
          }
          rawMessages.push({
            type: "tool-call",
            id: call.id,
            timestamp,
            model: model ?? undefined,
            toolName,
            input: mapToolInput(name, call.arguments),
          });
        }
      }
      continue;
    }

    if (msg.role === "toolResult") {
      const text = extractText(msg.content);
      const callId = msg.toolCallId;
      const idx = callId != null ? toolCallIndexById.get(callId) : undefined;
      if (idx !== undefined) {
        const call = rawMessages[idx];
        call.output = mapToolOutput(call.toolName as string, text);
        if (msg.isError) call.isError = true;
      } else {
        // Orphan result (no matching call in this transcript window): keep it visible.
        const orphanName = typeof msg.toolName === "string" ? normalizeToolName(msg.toolName) : "Tool";
        rawMessages.push({
          type: "tool-call",
          timestamp,
          toolName: orphanName,
          output: mapToolOutput(orphanName, text),
          isError: msg.isError ?? undefined,
        });
      }
    }
  }

  // Validate each message independently so one malformed entry (e.g. a future
  // OpenClaw record shape) is skipped rather than aborting the whole transcript.
  const unifiedMessages: UnifiedTranscriptMessage[] = [];
  for (const raw of rawMessages) {
    const parsed = unifiedTranscriptMessageSchema.safeParse(raw);
    if (parsed.success) {
      unifiedMessages.push(parsed.data);
    }
  }
  if (unifiedMessages.length === 0) {
    return null;
  }

  const tokenUsage: UnifiedTokenUsage = {
    inputTokens: totalInputTokens,
    cachedInputTokens: totalCacheReadTokens,
    outputTokens: totalOutputTokens,
    reasoningOutputTokens: 0,
    totalTokens: totalInputTokens + totalOutputTokens,
  };

  const gitContext =
    options.gitContext !== undefined
      ? options.gitContext
      : unifiedGitContextSchema.parse({ repo: null, branch: null, relativeCwd: null });

  const stats = calculateTranscriptStats(unifiedMessages);
  // Resolve a valid Date; a garbage/missing timestamp must not throw in z.coerce.date().
  const sessionStart = parseTimestamp(session?.timestamp ?? firstTimestamp(records)) ?? options.now ?? new Date(0);

  const transcript: UnifiedTranscript = unifiedTranscriptSchema.parse({
    v: 1 as const,
    id: session?.id ?? deriveId(records),
    source: "openclaw" as const,
    timestamp: sessionStart,
    preview: derivePreview(userTexts),
    summary: null,
    model: primaryModel,
    clientVersion: options.clientVersion ?? (session?.version != null ? String(session.version) : null),
    blendedTokens: totalInputTokens + totalOutputTokens,
    costUsd: totalCost,
    messageCount: unifiedMessages.length,
    ...stats,
    tokenUsage,
    modelUsage: primaryModel ? [unifiedModelUsageSchema.parse({ model: primaryModel, usage: tokenUsage })] : [],
    git: gitContext,
    cwd: cwd ? formatCwdWithTilde(cwd) : null,
    messages: unifiedMessages,
  });

  return transcript;
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeToolName(name: string): string {
  const lower = name.toLowerCase();
  return TOOL_NAME_MAP[lower] ?? name.charAt(0).toUpperCase() + name.slice(1);
}

function mapToolInput(name: string, args: Record<string, unknown> | undefined): unknown {
  const a = args ?? {};
  switch (name.toLowerCase()) {
    case "read":
      return { file_path: a.path ?? a.file_path };
    case "write":
      return { file_path: a.path ?? a.file_path, content: a.content };
    case "bash":
      return { command: a.command };
    default:
      return a;
  }
}

function mapToolOutput(canonicalToolName: string, text: string): unknown {
  if (!text) return text;
  switch (canonicalToolName) {
    case "Read": {
      const numLines = text.split("\n").length;
      return { file: { content: text, numLines, totalLines: numLines } };
    }
    case "Bash":
      return { stdout: text };
    default:
      // Generic tools (Write, Browser, Process, Message, ...) render the raw text.
      return text;
  }
}

function extractText(content: OpenClawInnerMessage["content"]): string {
  if (!Array.isArray(content)) return "";
  return content
    .map((block) =>
      block && typeof block === "object" && typeof (block as { text?: string }).text === "string"
        ? (block as { text?: string }).text
        : "",
    )
    .filter(Boolean)
    .join("\n")
    .trim();
}

/** Parse a timestamp string into a valid Date, or null when missing/invalid. */
function parseTimestamp(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function firstTimestamp(records: OpenClawRecord[]): string | undefined {
  for (const r of records) {
    if (r.type === "message" && typeof (r as OpenClawMessageRecord).timestamp === "string") {
      return (r as OpenClawMessageRecord).timestamp;
    }
  }
  return undefined;
}

function deriveId(records: OpenClawRecord[]): string {
  for (const r of records) {
    if (r.type === "message" && typeof (r as OpenClawMessageRecord).id === "string") {
      return (r as OpenClawMessageRecord).id as string;
    }
  }
  return "openclaw-session";
}

function derivePreview(userTexts: string[]): string | null {
  for (const text of userTexts) {
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!trimmed) continue;
    if (trimmed.startsWith("<") && trimmed.includes(">")) continue;
    return trimmed.replace(/^["']|["']$/g, "");
  }
  return userTexts.length > 0 ? userTexts[0].trim().replace(/\s+/g, " ") : null;
}

export type { UnifiedGitContext, UnifiedTokenUsage, UnifiedTranscript, UnifiedTranscriptMessage };
