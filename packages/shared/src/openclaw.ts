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
  reasoningTokens?: number;
  cost?: { total?: number };
};

export type OpenClawInnerMessage = {
  role: "user" | "assistant" | "toolResult";
  content?: string | Array<OpenClawContentBlock | { type: string; text?: string }>;
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
  sessionId?: string;
  onWarning?: (message: string) => void;
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
  exec: "Bash",
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
export function parseOpenClawRecords(content: string, onWarning?: (message: string) => void): OpenClawRecord[] {
  const records: OpenClawRecord[] = [];
  let skipped = 0;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const value: unknown = JSON.parse(line);
      if (asRecord(value)) records.push(value as OpenClawRecord);
      else skipped++;
    } catch {
      skipped++;
    }
  }
  if (skipped) onWarning?.(`Skipped ${skipped} malformed OpenClaw JSONL record(s).`);
  return records;
}

export function asOpenClawSession(records: unknown[]): OpenClawSessionRecord | null {
  const header = records.map(asRecord).find((r) => r?.type === "session");
  const id = asString(header?.id);
  if (!header || !id) return null;
  return {
    type: "session",
    id,
    cwd: asString(header.cwd),
    timestamp: asString(header.timestamp),
    version: typeof header.version === "number" && Number.isFinite(header.version) ? header.version : undefined,
  };
}

export function convertOpenClawTranscript(
  records: unknown[],
  options: ConvertOpenClawOptions = {},
): UnifiedTranscript | null {
  const session = asOpenClawSession(records);
  const cwd = options.cwd ?? session?.cwd ?? null;
  const rawMessages: Record<string, unknown>[] = [];
  const toolCallIndexes = new Map<string, number[]>();
  const userTexts: string[] = [];
  const modelUsage = new Map<string, UnifiedTokenUsage>();
  const tokenUsage = emptyUsage();
  let primaryModel: string | null = null;
  let totalCost = 0;
  let skipped = 0;

  for (const value of records) {
    const record = asRecord(value);
    if (!record) {
      skipped++;
      continue;
    }
    const timestamp = parseTimestamp(asString(record.timestamp))?.toISOString();
    const id = asString(record.id);
    if (record.type === "compaction") {
      const summary = asString(record.summary)?.trim();
      if (summary) rawMessages.push({ type: "compaction-summary", text: summary, id, timestamp });
      else if (record.summary != null) skipped++;
      continue;
    }
    if (record.type !== "message") continue;
    const msg = asRecord(record.message);
    if (!msg) {
      skipped++;
      continue;
    }
    const content = typeof msg.content === "string" ? [{ type: "text", text: msg.content }] : msg.content;
    const blocks = Array.isArray(content) ? content : [];
    if (content != null && !Array.isArray(content)) skipped++;

    if (msg.role === "user") {
      // Keep one message/identity per native user entry, including mixed block arrays.
      const text = extractText(content);
      if (text) {
        userTexts.push(text);
        rawMessages.push({ type: "user", text, id, timestamp });
      }
      skipped += blocks.filter(
        (b) => !asRecord(b) || (asRecord(b)?.type === "text" && typeof asRecord(b)?.text !== "string"),
      ).length;
    } else if (msg.role === "assistant") {
      const model = asString(msg.model);
      primaryModel ??= model ?? null;
      const usage = asRecord(msg.usage);
      if (usage) {
        const input = tokenNumber(usage.input);
        const output = tokenNumber(usage.output);
        const cacheRead = tokenNumber(usage.cacheRead);
        const cacheWrite = tokenNumber(usage.cacheWrite);
        const total =
          typeof usage.totalTokens === "number" && Number.isFinite(usage.totalTokens) && usage.totalTokens >= 0
            ? usage.totalTokens
            : input + output + cacheRead + cacheWrite;
        const delta = {
          inputTokens: input,
          outputTokens: output,
          cachedInputTokens: cacheRead,
          reasoningOutputTokens: tokenNumber(usage.reasoningTokens),
          totalTokens: total,
        };
        addUsage(tokenUsage, delta);
        if (model) {
          const aggregate = modelUsage.get(model) ?? emptyUsage();
          addUsage(aggregate, delta);
          modelUsage.set(model, aggregate);
        }
        totalCost += tokenNumber(asRecord(usage.cost)?.total);
      }
      for (const value of blocks) {
        const block = asRecord(value);
        if (!block) {
          skipped++;
          continue;
        }
        if (block.type === "text" || block.type === "thinking") {
          const text = asString(block.type === "text" ? block.text : block.thinking)?.trim();
          if (text)
            rawMessages.push({ type: block.type === "text" ? "agent" : "thinking", text, id, timestamp, model });
          else if (typeof (block.type === "text" ? block.text : block.thinking) !== "string") skipped++;
        } else if (block.type === "toolCall") {
          const name = asString(block.name) ?? "tool";
          const callId = asString(block.id);
          const calls = mapToolCalls(name, block.arguments ?? block.input, cwd);
          const indexes: number[] = [];
          for (const [index, call] of calls.entries()) {
            indexes.push(rawMessages.length);
            rawMessages.push({
              type: "tool-call",
              id: callId && calls.length > 1 ? `${callId}:${index}` : callId,
              timestamp,
              model,
              ...call,
            });
          }
          if (callId) toolCallIndexes.set(callId, indexes);
        }
      }
    } else if (msg.role === "toolResult") {
      const text = extractText(content);
      const callId = asString(msg.toolCallId);
      const indexes = callId ? toolCallIndexes.get(callId) : undefined;
      const isError = typeof msg.isError === "boolean" ? msg.isError : undefined;
      if (indexes) {
        for (const index of indexes) {
          const call = rawMessages[index];
          call.output = mapToolOutput(call.toolName as string, text, cwd);
          if (isError) call.isError = true;
        }
      } else {
        const toolName = normalizeToolName(asString(msg.toolName) ?? "Tool");
        rawMessages.push({
          type: "tool-call",
          id,
          timestamp,
          toolName,
          output: mapToolOutput(toolName, text, cwd),
          isError,
        });
      }
    }
  }

  const messages: UnifiedTranscriptMessage[] = [];
  for (const raw of rawMessages) {
    const parsed = unifiedTranscriptMessageSchema.safeParse(raw);
    if (parsed.success) messages.push(parsed.data);
    else skipped++;
  }
  if (skipped) options.onWarning?.(`Skipped ${skipped} malformed OpenClaw record(s) or content block(s).`);
  if (!messages.length) return null;
  const validRecords = records.map(asRecord).filter((r) => r !== null);
  const firstTimestamp = validRecords.map((r) => parseTimestamp(asString(r.timestamp))).find(Boolean);
  const sessionStart = parseTimestamp(session?.timestamp) ?? firstTimestamp ?? options.now ?? new Date(0);
  return unifiedTranscriptSchema.parse({
    v: 1,
    id: options.sessionId ?? session?.id ?? validRecords.map((r) => asString(r.id)).find(Boolean) ?? "openclaw-session",
    source: "openclaw",
    timestamp: sessionStart,
    preview: derivePreview(userTexts),
    summary: null,
    model: primaryModel,
    clientVersion: options.clientVersion ?? null,
    blendedTokens: tokenUsage.inputTokens + tokenUsage.outputTokens,
    costUsd: totalCost,
    messageCount: messages.length,
    ...calculateTranscriptStats(messages),
    tokenUsage,
    modelUsage: [...modelUsage].map(([model, usage]) => unifiedModelUsageSchema.parse({ model, usage })),
    git: options.gitContext ?? unifiedGitContextSchema.parse({ repo: null, branch: null, relativeCwd: null }),
    cwd: cwd ? formatCwdWithTilde(cwd) : null,
    messages,
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
function tokenNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}
function emptyUsage(): UnifiedTokenUsage {
  return { inputTokens: 0, outputTokens: 0, cachedInputTokens: 0, reasoningOutputTokens: 0, totalTokens: 0 };
}
function addUsage(target: UnifiedTokenUsage, delta: UnifiedTokenUsage): void {
  for (const key of Object.keys(target) as Array<keyof UnifiedTokenUsage>) target[key] += delta[key];
}
function normalizeToolName(name: string): string {
  return TOOL_NAME_MAP[name.toLowerCase()] ?? name.charAt(0).toUpperCase() + name.slice(1);
}
function mapToolCalls(name: string, args: unknown, cwd: string | null): Array<{ toolName: string; input: unknown }> {
  const a = asRecord(args) ?? {};
  const lower = name.toLowerCase();
  if (lower === "apply_patch" && Array.isArray(a.changes)) {
    const edits = a.changes.flatMap((value) => {
      const change = asRecord(value);
      if (!change || typeof change.path !== "string" || typeof change.diff !== "string") return [];
      return [
        {
          toolName: "Edit",
          input: {
            file_path: change.path,
            diff: change.diff,
            ...(asRecord(change.kind)?.move_path ? { move_path: asRecord(change.kind)?.move_path } : {}),
          },
        },
      ];
    });
    if (edits.length)
      return edits.map((edit) => ({ ...edit, input: cwd ? relativizePaths(edit.input, cwd) : edit.input }));
  }
  let input: Record<string, unknown> = a;
  if (lower === "read" || lower === "write" || lower === "edit") {
    const { path, file_path, ...rest } = a;
    input = { ...rest, file_path: path ?? file_path };
    if (lower === "edit" && typeof a.oldText === "string" && typeof a.newText === "string") {
      input.diff =
        [...a.oldText.split("\n").map((line) => `-${line}`), ...a.newText.split("\n").map((line) => `+${line}`)].join(
          "\n",
        ) + "\n";
    }
  }
  return [{ toolName: normalizeToolName(name), input: cwd ? relativizePaths(input, cwd) : input }];
}
function mapToolOutput(name: string, text: string, cwd: string | null): unknown {
  let result: unknown = text;
  if (text && name === "Read") {
    const numLines = text.split("\n").length;
    result = { file: { content: text, numLines, totalLines: numLines } };
  } else if (text && name === "Bash") result = { stdout: text };
  return cwd ? relativizePaths(result, cwd) : result;
}
export function extractOpenClawText(content: unknown): string {
  return extractText(content);
}
function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((value) => asString(asRecord(value)?.text) ?? "")
    .filter(Boolean)
    .join("\n")
    .trim();
}
function parseTimestamp(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
function derivePreview(userTexts: string[]): string | null {
  for (const text of userTexts) {
    const trimmed = text.trim().replace(/\s+/g, " ");
    if (!trimmed || (trimmed.startsWith("<") && trimmed.includes(">"))) continue;
    return trimmed.replace(/^["']|["']$/g, "");
  }
  return userTexts[0]?.trim().replace(/\s+/g, " ") ?? null;
}
export type { UnifiedGitContext, UnifiedTokenUsage, UnifiedTranscript, UnifiedTranscriptMessage };
