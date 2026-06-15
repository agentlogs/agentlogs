import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { z } from "zod";
import { locateGitRoot, getRepoIdFromGitRoot, readGitBranch } from "./git";
import { formatCwdWithTilde, normalizeRelativeCwd, relativizePaths } from "./paths";
import type { LiteLLMModelPricing } from "./pricing";
import {
  toolCallMessageWithShapesSchema,
  unifiedGitContextSchema,
  unifiedModelUsageSchema,
  unifiedTokenUsageSchema,
  unifiedTranscriptMessageSchema,
  unifiedTranscriptSchema,
} from "./schemas";

export type UnifiedTranscript = z.infer<typeof unifiedTranscriptSchema>;
export type UnifiedTranscriptMessage = z.infer<typeof unifiedTranscriptMessageSchema>;
export type UnifiedTokenUsage = z.infer<typeof unifiedTokenUsageSchema>;

export type UnifiedModelUsage = z.infer<typeof unifiedModelUsageSchema>;
export type UnifiedGitContext = z.infer<typeof unifiedGitContextSchema>;

export type TranscriptBlob = {
  data: Buffer;
  mediaType: string;
};

export type ConversionResult = {
  transcript: UnifiedTranscript;
  blobs: Map<string, TranscriptBlob>;
};

export type ConvertClaudeCodeOptions = {
  pricing?: Record<string, LiteLLMModelPricing>;
  now?: Date;
  gitContext?: UnifiedGitContext | null;
  clientVersion?: string;
};

type ClaudeUsage = {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
};

type ClaudeMessagePayload = {
  id?: string;
  role?: string;
  content?: unknown;
  model?: string;
  usage?: ClaudeUsage | null;
};

type ClaudeMessageRecord = {
  uuid: string;
  type: string;
  timestamp?: string;
  parentUuid?: string | null;
  logicalParentUuid?: string | null;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  costUSD?: number;
  message?: ClaudeMessagePayload;
  raw: Record<string, unknown>;
};

type ClaudeUsageDetail = {
  model: string | null;
  usage: ClaudeUsage;
};

type TokenUsage = z.infer<typeof unifiedTokenUsageSchema>;

const DEFAULT_TIERED_THRESHOLD = 200_000;
const PROVIDER_PREFIXES = [
  "anthropic/",
  "claude-3-5-",
  "claude-3-",
  "claude-",
  "openai/",
  "azure/",
  "openrouter/openai/",
];

const IGNORE_STATUS_MESSAGES = new Set([
  "[request interrupted by user]",
  "[request aborted by user]",
  "[request cancelled by user]",
]);

// Commands to ignore when converting transcripts (no value in keeping them)
const IGNORED_COMMANDS = new Set(["/clear"]);

const COMMAND_ENVELOPE_PATTERN = /^<\/?(?:command|local)-[a-z-]+>/i;
const SHELL_PROMPT_PATTERN = /^[α-ωΑ-Ω]\s/i;

// Patterns for command message parsing
const COMMAND_NAME_PATTERN = /<command-name>(.*?)<\/command-name>/s;
const COMMAND_ARGS_PATTERN = /<command-args>(.*?)<\/command-args>/s;
const LOCAL_COMMAND_STDOUT_PATTERN = /^<local-command-stdout>(.*)<\/local-command-stdout>$/s;
const SYSTEM_REMINDER_PATTERN = /<system-reminder>[\s\S]*?<\/system-reminder>/g;

const NON_PROMPT_PREFIXES = [
  "npm ",
  "npm:",
  "npm error",
  "node:",
  "node.js",
  "error:",
  "fatal:",
  "warning:",
  "traceback (most recent call last):",
  "usage:",
  "hint:",
  "note:",
  "code:",
  "requirestack",
];

const PROMPT_KEYWORD_PATTERN = new RegExp(
  "\\b(" +
    [
      "fix",
      "please",
      "should",
      "update",
      "change",
      "add",
      "remove",
      "create",
      "write",
      "implement",
      "refactor",
      "investigate",
      "explain",
      "help",
      "why",
      "what",
      "how",
      "need",
      "ensure",
      "make",
      "build",
      "let's",
      "optimize",
      "review",
      "check",
    ].join("|") +
    ")\\b",
  "i",
);

const MAX_SUMMARY_LINES = 3;

/**
 * Calculate aggregate stats from unified messages
 */
export type TranscriptStats = {
  toolCount: number;
  userMessageCount: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  linesModified: number;
};

export function calculateTranscriptStats(messages: UnifiedTranscriptMessage[]): TranscriptStats {
  let toolCount = 0;
  let userMessageCount = 0;
  let totalAdded = 0;
  let totalRemoved = 0;
  let totalModified = 0;
  const changedFiles = new Set<string>();

  for (const msg of messages) {
    if (msg.type === "user") {
      userMessageCount++;
    } else if (msg.type === "tool-call") {
      toolCount++;

      // Skip counting modifications for tool calls with errors
      if (msg.isError || msg.error) {
        continue;
      }

      // Track file changes from Edit and Write tools
      const toolName = msg.toolName;
      const input = msg.input as Record<string, unknown> | undefined;
      const output = msg.output as Record<string, unknown> | undefined;

      // Unified format uses file_path (snake_case)
      if (input && typeof input.file_path === "string") {
        if (toolName === "Edit" || toolName === "Write") {
          changedFiles.add(input.file_path);
        }
      }

      // Count lines from Write tool (new file creation)
      if (toolName === "Write" && input && typeof input.content === "string") {
        const lineCount = input.content.split("\n").length;
        totalAdded += lineCount;
      }

      // Parse diff to count additions/removals/modifications
      // Diff can be in input (Claude Code) or output (OpenCode)
      const diff = input?.diff ?? output?.diff;
      if (toolName === "Edit" && typeof diff === "string") {
        let diffAdded = 0;
        let diffRemoved = 0;
        const diffLines = diff.split("\n");
        for (const line of diffLines) {
          if (line.startsWith("+") && !line.startsWith("+++")) {
            diffAdded++;
          } else if (line.startsWith("-") && !line.startsWith("---")) {
            diffRemoved++;
          }
        }
        // Modifications are paired additions/removals
        const modified = Math.min(diffAdded, diffRemoved);
        totalAdded += diffAdded - modified;
        totalRemoved += diffRemoved - modified;
        totalModified += modified;
      }
    }
  }

  return {
    toolCount,
    userMessageCount,
    filesChanged: changedFiles.size,
    linesAdded: totalAdded,
    linesRemoved: totalRemoved,
    linesModified: totalModified,
  };
}

/**
 * Convert a Claude Code transcript from an array of message records
 * (for testing or in-memory processing)
 */
export function convertClaudeCodeTranscript(
  transcript: Array<Record<string, unknown>>,
  options: ConvertClaudeCodeOptions = {},
): ConversionResult | null {
  const parseResult = parseClaudeTranscript(transcript);
  if (parseResult.records.size === 0) {
    return null;
  }

  // Build flat transcript - all non-sidechain messages sorted by timestamp
  const flatTranscript = buildFlatTranscript(parseResult.records);
  if (flatTranscript.length === 0) {
    return null;
  }

  const lastMessage = flatTranscript[flatTranscript.length - 1];
  const usageMessages = collectAssistantUsageMessages(flatTranscript);
  const tokenUsage = aggregateUsage(usageMessages);
  const modelUsageMap = aggregateUsageByModel(usageMessages);
  const blendedTokens = blendedTokenTotal(tokenUsage);
  const usageDetails = usageMessages
    .map<ClaudeUsageDetail | null>((message) => {
      const usage = message.message?.usage;
      if (!usage) {
        return null;
      }
      return {
        model: message.message?.model ?? null,
        usage,
      };
    })
    .filter((detail): detail is ClaudeUsageDetail => detail !== null);

  const costUsd = calculateCostFromUsageDetails(usageDetails, options.pricing);
  const promptMessages = findPromptUserMessages(flatTranscript);
  const previewMessage = promptMessages.length > 0 ? summarizeMessage(promptMessages[0]) : null;

  const timestamp = parseDate(lastMessage.timestamp) ?? options.now ?? new Date();
  const sessionId = findSessionId(flatTranscript);
  const primaryModel = selectPrimaryModel(modelUsageMap);
  const cwd = deriveWorkingDirectory(flatTranscript);
  // Use provided git context or fall back to path-based extraction
  const gitContext =
    options.gitContext !== undefined ? options.gitContext : extractGitContextFromRecords(flatTranscript);
  const formattedCwd = cwd ? formatCwdWithTilde(cwd) : "";
  const { messages, blobs } = convertTranscriptToMessages(flatTranscript);

  if (messages.length === 0) {
    return null;
  }

  const stats = calculateTranscriptStats(messages);

  const transcriptCandidate = {
    v: 1 as const,
    id: sessionId ?? lastMessage.uuid,
    source: "claude-code" as const,
    timestamp,
    preview: previewMessage,
    summary: null,
    model: primaryModel,
    clientVersion: options.clientVersion ?? extractClientVersion(flatTranscript),
    blendedTokens,
    costUsd,
    messageCount: messages.length,
    ...stats,
    tokenUsage,
    modelUsage: Array.from(modelUsageMap.entries()).map(([model, usage]) => ({
      model: standardizeModelName(model),
      usage,
    })),
    git: gitContext,
    cwd: formattedCwd,
    messages,
  };

  return {
    transcript: unifiedTranscriptSchema.parse(transcriptCandidate),
    blobs,
  };
}

export async function convertClaudeCodeFile(
  filePath: string,
  options: ConvertClaudeCodeOptions = {},
): Promise<ConversionResult | null> {
  const parseResult = await parseClaudeJsonl(filePath);
  if (parseResult.records.size === 0) {
    return null;
  }

  // Build flat transcript - all non-sidechain messages sorted by timestamp
  const flatTranscript = buildFlatTranscript(parseResult.records);
  if (flatTranscript.length === 0) {
    return null;
  }

  const lastMessage = flatTranscript[flatTranscript.length - 1];
  const usageMessages = collectAssistantUsageMessages(flatTranscript);
  const tokenUsage = aggregateUsage(usageMessages);
  const modelUsageMap = aggregateUsageByModel(usageMessages);
  const blendedTokens = blendedTokenTotal(tokenUsage);
  const usageDetails = usageMessages
    .map<ClaudeUsageDetail | null>((message) => {
      const usage = message.message?.usage;
      if (!usage) {
        return null;
      }
      return {
        model: message.message?.model ?? null,
        usage,
      };
    })
    .filter((detail): detail is ClaudeUsageDetail => detail !== null);

  const costUsd = calculateCostFromUsageDetails(usageDetails, options.pricing);
  const promptMessages = findPromptUserMessages(flatTranscript);
  const previewMessage = promptMessages.length > 0 ? summarizeMessage(promptMessages[0]) : null;

  const timestamp = parseDate(lastMessage.timestamp) ?? (await getFileMTime(filePath)) ?? new Date();
  const sessionId = findSessionId(flatTranscript);
  const primaryModel = selectPrimaryModel(modelUsageMap);
  const cwd = deriveWorkingDirectory(flatTranscript);
  const formattedCwd = cwd ? formatCwdWithTilde(cwd) : "";
  const gitContext =
    options.gitContext !== undefined ? options.gitContext : await resolveGitContext(cwd, lastMessage.gitBranch);
  const { messages, blobs } = convertTranscriptToMessages(flatTranscript);

  if (messages.length === 0) {
    return null;
  }

  const stats = calculateTranscriptStats(messages);

  const transcriptCandidate = {
    v: 1 as const,
    id: sessionId ?? lastMessage.uuid,
    source: "claude-code" as const,
    timestamp,
    preview: previewMessage,
    summary: null,
    model: primaryModel,
    clientVersion: options.clientVersion ?? extractClientVersion(flatTranscript),
    blendedTokens,
    costUsd,
    messageCount: messages.length,
    ...stats,
    tokenUsage,
    modelUsage: Array.from(modelUsageMap.entries()).map(([model, usage]) => ({
      model: standardizeModelName(model),
      usage,
    })),
    git: gitContext,
    cwd: formattedCwd,
    messages,
  };

  return {
    transcript: unifiedTranscriptSchema.parse(transcriptCandidate),
    blobs,
  };
}

export async function convertClaudeCodeFiles(
  filePaths: string[],
  options: ConvertClaudeCodeOptions = {},
): Promise<ConversionResult[]> {
  const results: ConversionResult[] = [];
  for (const filePath of filePaths) {
    const result = await convertClaudeCodeFile(filePath, options);
    if (result) {
      results.push(result);
    }
  }
  return results;
}

function parseClaudeTranscript(transcript: Array<Record<string, unknown>>): {
  records: Map<string, ClaudeMessageRecord>;
  children: Map<string, Set<string>>;
} {
  const records = new Map<string, ClaudeMessageRecord>();
  const children = new Map<string, Set<string>>();

  for (const parsed of transcript) {
    const type = typeof parsed.type === "string" ? parsed.type : "";
    if (type === "summary") {
      continue;
    }

    const uuid = typeof parsed.uuid === "string" ? parsed.uuid : null;
    if (!uuid) {
      continue;
    }

    const record: ClaudeMessageRecord = {
      uuid,
      type,
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : undefined,
      parentUuid:
        typeof parsed.parentUuid === "string" || parsed.parentUuid === null
          ? (parsed.parentUuid as string | null | undefined)
          : undefined,
      logicalParentUuid:
        typeof parsed.logicalParentUuid === "string" || parsed.logicalParentUuid === null
          ? (parsed.logicalParentUuid as string | null | undefined)
          : undefined,
      isSidechain: Boolean(parsed.isSidechain),
      isMeta: Boolean(parsed.isMeta),
      isCompactSummary: Boolean(parsed.isCompactSummary),
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
      gitBranch: typeof parsed.gitBranch === "string" ? parsed.gitBranch : undefined,
      costUSD: typeof parsed.costUSD === "number" ? parsed.costUSD : undefined,
      message: extractMessagePayload(parsed.message),
      raw: parsed,
    };

    records.set(uuid, record);

    if (record.parentUuid) {
      const set = children.get(record.parentUuid) ?? new Set<string>();
      set.add(uuid);
      children.set(record.parentUuid, set);
    }
  }

  return { records, children };
}

async function parseClaudeJsonl(filePath: string): Promise<{
  records: Map<string, ClaudeMessageRecord>;
  children: Map<string, Set<string>>;
}> {
  const content = await fs.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);
  const records = new Map<string, ClaudeMessageRecord>();
  const children = new Map<string, Set<string>>();

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const type = typeof parsed.type === "string" ? parsed.type : "";
    if (type === "summary") {
      continue;
    }

    const uuid = typeof parsed.uuid === "string" ? parsed.uuid : null;
    if (!uuid) {
      continue;
    }

    const record: ClaudeMessageRecord = {
      uuid,
      type,
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : undefined,
      parentUuid:
        typeof parsed.parentUuid === "string" || parsed.parentUuid === null
          ? (parsed.parentUuid as string | null | undefined)
          : undefined,
      logicalParentUuid:
        typeof parsed.logicalParentUuid === "string" || parsed.logicalParentUuid === null
          ? (parsed.logicalParentUuid as string | null | undefined)
          : undefined,
      isSidechain: Boolean(parsed.isSidechain),
      isMeta: Boolean(parsed.isMeta),
      isCompactSummary: Boolean(parsed.isCompactSummary),
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
      cwd: typeof parsed.cwd === "string" ? parsed.cwd : undefined,
      gitBranch: typeof parsed.gitBranch === "string" ? parsed.gitBranch : undefined,
      costUSD: typeof parsed.costUSD === "number" ? parsed.costUSD : undefined,
      message: extractMessagePayload(parsed.message),
      raw: parsed,
    };

    records.set(uuid, record);

    if (record.parentUuid) {
      const set = children.get(record.parentUuid) ?? new Set<string>();
      set.add(uuid);
      children.set(record.parentUuid, set);
    }
  }

  return { records, children };
}

function extractMessagePayload(value: unknown): ClaudeMessagePayload | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : undefined;
  const role = typeof record.role === "string" ? record.role : undefined;
  const content = record.content;
  const model = typeof record.model === "string" ? record.model : undefined;
  const usage = extractUsage(record.usage);
  return { id, role, content, model, usage };
}

function extractUsage(value: unknown): ClaudeUsage | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Record<string, unknown>;
  const usage: ClaudeUsage = {};
  if (typeof record.input_tokens === "number") {
    usage.input_tokens = record.input_tokens;
  }
  if (typeof record.cache_creation_input_tokens === "number") {
    usage.cache_creation_input_tokens = record.cache_creation_input_tokens;
  }
  if (typeof record.cache_read_input_tokens === "number") {
    usage.cache_read_input_tokens = record.cache_read_input_tokens;
  }
  if (typeof record.output_tokens === "number") {
    usage.output_tokens = record.output_tokens;
  }
  if (typeof record.reasoning_output_tokens === "number") {
    usage.reasoning_output_tokens = record.reasoning_output_tokens;
  }
  return Object.keys(usage).length > 0 ? usage : null;
}

/**
 * Build a flat transcript from all records, filtering out sidechains and sorting by timestamp.
 * This is simpler than chain-walking and correctly handles parallel tool calls.
 */
function buildFlatTranscript(records: Map<string, ClaudeMessageRecord>): ClaudeMessageRecord[] {
  const messages: ClaudeMessageRecord[] = [];

  for (const record of records.values()) {
    // Skip sidechains - these are alternate conversation branches
    if (record.isSidechain) {
      continue;
    }
    messages.push(record);
  }

  // Sort by timestamp ascending (chronological order)
  messages.sort((a, b) => {
    const aTime = timestampToNumber(a.timestamp) ?? 0;
    const bTime = timestampToNumber(b.timestamp) ?? 0;
    if (aTime !== bTime) {
      return aTime - bTime;
    }
    // Same timestamp: sort by uuid for stability
    return a.uuid.localeCompare(b.uuid);
  });

  return messages;
}

function collectAssistantUsageMessages(transcript: ClaudeMessageRecord[]): ClaudeMessageRecord[] {
  const unique = new Map<string, ClaudeMessageRecord>();

  for (const message of transcript) {
    if (message.type !== "assistant") {
      continue;
    }

    const payload = message.message;
    if (!payload?.usage) {
      continue;
    }

    const key = getAssistantUsageKey(message);
    unique.set(key, message);
  }

  return Array.from(unique.values());
}

function getAssistantUsageKey(message: ClaudeMessageRecord): string {
  const payload = message.message;
  const messageId = asNonEmptyString(payload?.id);
  const requestId = asNonEmptyString((message.raw as Record<string, unknown>).requestId);
  if (messageId && requestId) {
    return `${messageId}:${requestId}`;
  }
  if (messageId) {
    return messageId;
  }
  if (requestId) {
    return requestId;
  }
  return message.uuid;
}

function aggregateUsage(messages: ClaudeMessageRecord[]): TokenUsage {
  const usage: TokenUsage = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
  };

  for (const message of messages) {
    const stats = message.message?.usage;
    if (!stats) {
      continue;
    }
    const input = ensureNumber(stats.input_tokens);
    const cacheCreation = ensureNumber(stats.cache_creation_input_tokens);
    const cacheRead = ensureNumber(stats.cache_read_input_tokens);
    const output = ensureNumber(stats.output_tokens);
    const reasoning = ensureNumber(stats.reasoning_output_tokens);

    usage.inputTokens += input + cacheCreation + cacheRead;
    usage.cachedInputTokens += cacheRead;
    usage.outputTokens += output;
    usage.reasoningOutputTokens += reasoning;
    usage.totalTokens += input + cacheCreation + cacheRead + output + reasoning;
  }

  return usage;
}

function aggregateUsageByModel(messages: ClaudeMessageRecord[]): Map<string, TokenUsage> {
  const perModel = new Map<string, TokenUsage>();

  for (const message of messages) {
    const model = message.message?.model;
    const usage = message.message?.usage;
    if (!model || !usage) {
      continue;
    }

    const record =
      perModel.get(model) ??
      ({
        inputTokens: 0,
        cachedInputTokens: 0,
        outputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
      } satisfies TokenUsage);

    const input = ensureNumber(usage.input_tokens);
    const cacheCreation = ensureNumber(usage.cache_creation_input_tokens);
    const cacheRead = ensureNumber(usage.cache_read_input_tokens);
    const output = ensureNumber(usage.output_tokens);
    const reasoning = ensureNumber(usage.reasoning_output_tokens);

    record.inputTokens += input + cacheCreation + cacheRead;
    record.cachedInputTokens += cacheRead;
    record.outputTokens += output;
    record.reasoningOutputTokens += reasoning;
    record.totalTokens += input + cacheCreation + cacheRead + output + reasoning;

    perModel.set(model, record);
  }

  return perModel;
}

function findPromptUserMessages(transcript: ClaudeMessageRecord[]): ClaudeMessageRecord[] {
  const prompts: ClaudeMessageRecord[] = [];

  for (const message of transcript) {
    if (!isPromptCandidate(message)) {
      continue;
    }
    prompts.push(message);
  }

  return prompts;
}

function isPromptCandidate(message: ClaudeMessageRecord): boolean {
  if (message.type !== "user") {
    return false;
  }
  if (message.isSidechain) {
    return false;
  }
  if (message.isMeta) {
    return false;
  }

  const raw = message.raw as Record<string, unknown>;
  if (raw && typeof raw === "object") {
    if ("toolUseResult" in raw) {
      return false;
    }
  }

  const content = message.message?.content;
  if (Array.isArray(content)) {
    if (content.some((part) => isToolResultPart(part))) {
      return false;
    }
  }

  const normalized = getNormalizedMessageText(message);
  if (!normalized) {
    return false;
  }

  const lower = normalized.toLowerCase();
  if (IGNORE_STATUS_MESSAGES.has(lower)) {
    return false;
  }
  if (isCommandEnvelope(normalized)) {
    return false;
  }
  if (SHELL_PROMPT_PATTERN.test(normalized)) {
    return false;
  }

  if (NON_PROMPT_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
    if (!hasPromptCue(normalized)) {
      return false;
    }
  }

  return true;
}

function isToolResultPart(part: unknown): boolean {
  if (!part || typeof part !== "object") {
    return false;
  }
  const record = part as Record<string, unknown>;
  if (record.type === "tool_result") {
    return true;
  }
  if (typeof record.tool_use_id === "string") {
    return true;
  }
  return false;
}

function isCommandEnvelope(value: string): boolean {
  return COMMAND_ENVELOPE_PATTERN.test(value);
}

function summarizeMessage(message: ClaudeMessageRecord): string | null {
  const normalized = getNormalizedMessageText(message);
  if (!normalized) {
    return null;
  }
  return collapseWhitespace(normalized);
}

function deriveWorkingDirectory(transcript: ClaudeMessageRecord[]): string | undefined {
  for (const message of transcript) {
    if (message.cwd) {
      return message.cwd;
    }
  }
  return undefined;
}

function extractClientVersion(transcript: ClaudeMessageRecord[]): string | null {
  for (const message of transcript) {
    const version = message.raw.version;
    if (typeof version === "string" && version.length > 0) {
      return version;
    }
  }
  return null;
}

function extractGitContextFromRecords(transcript: ClaudeMessageRecord[]): UnifiedGitContext {
  const cwd = deriveWorkingDirectory(transcript);
  const gitBranch = transcript.find((r) => r.gitBranch)?.gitBranch ?? null;

  if (!cwd) {
    return unifiedGitContextSchema.parse({
      relativeCwd: null,
      branch: gitBranch,
      repo: null,
    });
  }

  const pathParts = cwd.split(/[\\/]+/).filter(Boolean);
  if (pathParts.length === 0) {
    return unifiedGitContextSchema.parse({
      relativeCwd: null,
      branch: gitBranch,
      repo: null,
    });
  }

  const hostingIndex = pathParts.findIndex((part) => {
    const normalized = part.toLowerCase();
    return normalized.includes("github") || normalized.includes("gitlab") || normalized.includes("bitbucket");
  });

  if (hostingIndex >= 0) {
    const hostSegment = pathParts[hostingIndex]?.toLowerCase() ?? "";
    const host = hostSegment.includes("gitlab")
      ? "gitlab.com"
      : hostSegment.includes("bitbucket")
        ? "bitbucket.org"
        : "github.com";

    const org = pathParts[hostingIndex + 1];
    const repoName = pathParts[hostingIndex + 2]?.replace(/\.git$/i, "");
    if (org && repoName) {
      const relativeSegments = pathParts.slice(hostingIndex + 3);
      const relativeCwd = relativeSegments.length > 0 ? relativeSegments.join("/") : ".";
      return unifiedGitContextSchema.parse({
        relativeCwd: normalizeRelativeCwd(relativeCwd),
        branch: gitBranch,
        repo: `${host}/${org}/${repoName}`,
      });
    }
  }

  return unifiedGitContextSchema.parse({
    relativeCwd: null,
    branch: gitBranch,
    repo: null,
  });
}

export async function resolveGitContext(
  cwd: string | undefined,
  gitBranch: string | undefined,
): Promise<UnifiedGitContext> {
  if (!cwd) {
    return null;
  }

  try {
    const stats = await fs.stat(cwd);
    if (!stats.isDirectory()) {
      return unifiedGitContextSchema.parse({
        relativeCwd: null,
        branch: gitBranch ?? null,
        repo: null,
      });
    }
  } catch {
    return unifiedGitContextSchema.parse({
      relativeCwd: null,
      branch: gitBranch ?? null,
      repo: null,
    });
  }

  const repoRoot = await locateGitRoot(cwd);
  if (!repoRoot) {
    return unifiedGitContextSchema.parse({
      relativeCwd: null,
      branch: gitBranch ?? null,
      repo: null,
    });
  }

  const relativeCwd = path.relative(repoRoot, cwd) || ".";
  const branch = gitBranch ?? (await readGitBranch(repoRoot));
  const repo = await getRepoIdFromGitRoot(repoRoot);

  return unifiedGitContextSchema.parse({
    relativeCwd: normalizeRelativeCwd(relativeCwd),
    branch,
    repo,
  });
}

function findSessionId(transcript: ClaudeMessageRecord[]): string | null {
  for (const message of transcript) {
    const rawId = typeof message.sessionId === "string" ? message.sessionId.trim() : "";
    if (rawId.length > 0) {
      return rawId;
    }
  }
  return null;
}

/**
 * Standardize model name by ensuring it has a provider prefix.
 * If the model name doesn't contain a `/`, prepends `anthropic/`.
 */
function standardizeModelName(model: string): string {
  if (model.includes("/")) {
    return model;
  }
  return `anthropic/${model}`;
}

function selectPrimaryModel(modelUsage: Map<string, TokenUsage>): string | null {
  let primaryModel: string | null = null;
  let highestTokens = -1;
  for (const [modelName, usage] of modelUsage) {
    const tokens = usage.totalTokens > 0 ? usage.totalTokens : usage.inputTokens + usage.outputTokens;
    if (tokens > highestTokens) {
      highestTokens = tokens;
      primaryModel = modelName;
    }
  }
  return primaryModel ? standardizeModelName(primaryModel) : null;
}

function getNormalizedMessageText(message: ClaudeMessageRecord): string | null {
  const candidates = extractNormalizedCandidates(message.message);
  return candidates[0] ?? null;
}

function extractNormalizedCandidates(payload: ClaudeMessagePayload | undefined): string[] {
  if (!payload) {
    return [];
  }

  const content = payload.content;

  if (typeof content === "string") {
    const normalized = normalizeStringContent(content);
    return normalized ? [normalized] : [];
  }

  if (Array.isArray(content)) {
    const results: string[] = [];
    for (const part of content) {
      if (typeof part === "string") {
        const normalized = normalizeStringContent(part);
        if (normalized) {
          results.push(normalized);
        }
        continue;
      }
      if (part && typeof part === "object") {
        const record = part as Record<string, unknown>;
        const fields = ["content", "text"];
        for (const field of fields) {
          const value = record[field];
          if (typeof value === "string") {
            const normalized = normalizeStringContent(value);
            if (normalized) {
              results.push(normalized);
            }
          }
        }
      }
    }
    return results;
  }

  return [];
}

function normalizeStringContent(value: string, maxLines = MAX_SUMMARY_LINES): string | null {
  const lines = extractMeaningfulLines(value);
  if (lines.length === 0) {
    return null;
  }

  const selected = lines.slice(0, maxLines);
  const merged = selected.join(" ");
  const normalized = collapseWhitespace(merged);
  return normalized.length > 0 ? normalized : null;
}

function extractMeaningfulLines(value: string): string[] {
  const lines: string[] = [];
  for (const rawLine of value.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    const lower = trimmed.toLowerCase();
    if (IGNORE_STATUS_MESSAGES.has(lower)) {
      continue;
    }
    if (isCommandEnvelope(trimmed)) {
      continue;
    }
    if (SHELL_PROMPT_PATTERN.test(trimmed)) {
      continue;
    }

    if (NON_PROMPT_PREFIXES.some((prefix) => lower.startsWith(prefix))) {
      if (!hasPromptCue(trimmed)) {
        continue;
      }
    }

    if (!/[a-z]/i.test(trimmed) && !/\d/.test(trimmed)) {
      continue;
    }

    lines.push(trimmed);
  }
  return lines;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function hasPromptCue(value: string): boolean {
  const lower = value.toLowerCase();
  if (PROMPT_KEYWORD_PATTERN.test(lower)) {
    return true;
  }

  if (lower.includes("?")) {
    return true;
  }

  const cuePhrases = [
    "can you",
    "can we",
    "could you",
    "could we",
    "would you",
    "would we",
    "should we",
    "should i",
    "let's",
    "let us",
  ];

  return cuePhrases.some((phrase) => lower.includes(phrase));
}

function blendedTokenTotal(usage: TokenUsage): number {
  const nonCached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return nonCached + usage.outputTokens + usage.reasoningOutputTokens;
}

async function getFileMTime(filePath: string): Promise<Date | null> {
  try {
    const stats = await fs.stat(filePath);
    return stats.mtime;
  } catch {
    return null;
  }
}

function parseDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timestampToNumber(value: string | undefined): number | null {
  const date = parseDate(value);
  return date ? date.getTime() : null;
}

function ensureNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function computeSha256(data: Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Recursively sanitize images in a value, replacing base64 data with sha256 references.
 * Extracts blobs and adds them to the provided map.
 */
function sanitizeImagesInValue(value: unknown, blobs: Map<string, TranscriptBlob>): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeImagesInValue(item, blobs));
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;

    // Check if this is an image object with source.data
    if (obj.type === "image" && obj.source && typeof obj.source === "object") {
      const source = obj.source as Record<string, unknown>;
      if (typeof source.data === "string" && source.data.length > 0) {
        const base64Data = source.data;
        const mediaType =
          typeof source.mediaType === "string"
            ? source.mediaType
            : typeof source.media_type === "string"
              ? source.media_type
              : "image/unknown";

        const data = Buffer.from(base64Data, "base64");
        const sha256 = computeSha256(data);

        if (!blobs.has(sha256)) {
          blobs.set(sha256, { data, mediaType });
        }

        // Return sanitized image with sha256 reference instead of data
        return {
          type: "image",
          source: {
            type: "sha256",
            mediaType,
            sha256,
          },
        };
      }
    }

    // Recursively sanitize object properties
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj)) {
      result[key] = sanitizeImagesInValue(val, blobs);
    }
    return result;
  }

  return value;
}

/**
 * Extract image references from a sanitized value.
 * Looks for { type: "image", source: { type: "sha256", sha256, mediaType } } objects.
 */
function extractImageReferencesFromValue(value: unknown): Array<{ sha256: string; mediaType: string }> {
  const images: Array<{ sha256: string; mediaType: string }> = [];

  function traverse(v: unknown): void {
    if (v === null || v === undefined) return;

    if (Array.isArray(v)) {
      for (const item of v) {
        traverse(item);
      }
      return;
    }

    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;

      // Check if this is a sanitized image reference
      if (obj.type === "image" && obj.source && typeof obj.source === "object") {
        const source = obj.source as Record<string, unknown>;
        if (source.type === "sha256" && typeof source.sha256 === "string") {
          images.push({
            sha256: source.sha256,
            mediaType: typeof source.mediaType === "string" ? source.mediaType : "image/unknown",
          });
          return;
        }
      }

      // Recursively check object properties
      for (const val of Object.values(obj)) {
        traverse(val);
      }
    }
  }

  traverse(value);
  return images;
}

function calculateCostFromUsageDetails(
  usageDetails: ClaudeUsageDetail[],
  pricingData: Record<string, LiteLLMModelPricing> | undefined,
): number {
  if (!pricingData || Object.keys(pricingData).length === 0) {
    return 0;
  }

  let total = 0;
  for (const detail of usageDetails) {
    const modelName = detail.model;
    if (!modelName) {
      continue;
    }

    const pricing = resolvePricingForModel(modelName, pricingData);
    if (!pricing) {
      continue;
    }

    const cost = calculateCostFromPricing(
      {
        input_tokens: ensureNumber(detail.usage.input_tokens),
        output_tokens: ensureNumber(detail.usage.output_tokens),
        cache_creation_input_tokens: ensureNumber(detail.usage.cache_creation_input_tokens),
        cache_read_input_tokens: ensureNumber(detail.usage.cache_read_input_tokens),
      },
      pricing,
    );

    total += cost;
  }

  return total;
}

function resolvePricingForModel(
  modelName: string,
  pricingData: Record<string, LiteLLMModelPricing>,
): LiteLLMModelPricing | null {
  const normalizedName = modelName.trim();
  if (!normalizedName) {
    return null;
  }

  const candidates = new Set<string>();
  candidates.add(normalizedName);
  for (const prefix of PROVIDER_PREFIXES) {
    candidates.add(`${prefix}${normalizedName}`);
  }

  for (const candidate of candidates) {
    const pricing = pricingData[candidate];
    if (pricing) {
      return pricing;
    }
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
    if (totalTokens == null || totalTokens <= 0) {
      return 0;
    }

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

type ParsedCommand = {
  name: string;
  args: string | undefined;
};

/**
 * Parse a command message from text containing <command-name> tags
 * Returns null if not a command message
 */
function parseCommandMessage(text: string): ParsedCommand | null {
  const nameMatch = text.match(COMMAND_NAME_PATTERN);
  if (!nameMatch) {
    return null;
  }

  const name = nameMatch[1].trim();
  const argsMatch = text.match(COMMAND_ARGS_PATTERN);
  const args = argsMatch?.[1]?.trim() || undefined;

  return { name, args: args || undefined };
}

/**
 * Extract stdout from a <local-command-stdout> message
 * Returns null if not a local command stdout message
 */
function parseLocalCommandStdout(text: string): string | null {
  const match = text.trim().match(LOCAL_COMMAND_STDOUT_PATTERN);
  if (!match) {
    return null;
  }
  return match[1];
}

/**
 * Strip <system-reminder> tags from text
 */
function stripSystemReminders(text: string): string {
  return text.replace(SYSTEM_REMINDER_PATTERN, "").trim();
}

/**
 * Strip ANSI escape codes from text
 */
function stripAnsiCodes(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1B\[[0-9;]*m/g, "");
}

function extractQueuedCommandPrompt(record: ClaudeMessageRecord): string | null {
  if (record.type !== "attachment") {
    return null;
  }

  const attachment = record.raw.attachment;
  if (!attachment || typeof attachment !== "object") {
    return null;
  }

  const attachmentRecord = attachment as Record<string, unknown>;
  if (attachmentRecord.type !== "queued_command") {
    return null;
  }

  return asNonEmptyString(attachmentRecord.prompt) ?? null;
}

type ConvertMessagesResult = {
  messages: UnifiedTranscriptMessage[];
  blobs: Map<string, TranscriptBlob>;
};

function convertTranscriptToMessages(transcript: ClaudeMessageRecord[]): ConvertMessagesResult {
  const messages: UnifiedTranscriptMessage[] = [];
  const blobs = new Map<string, TranscriptBlob>();
  const toolCallById = new Map<
    string,
    {
      index: number;
      toolName: string | null;
    }
  >();

  // Track pending command waiting for stdout
  let pendingCommand: {
    name: string;
    args: string | undefined;
    id: string;
    timestamp: string | undefined;
  } | null = null;

  // Track if we should skip the next stdout (from an ignored command like /clear)
  let skipNextStdout = false;

  // Track seen user messages by (timestamp, text) to deduplicate
  // Claude Code sometimes logs the same message twice (once with images, once without)
  const seenUserMessages = new Map<string, { index: number; hasImages: boolean }>();

  // Track seen assistant messages by (id, timestamp, text) to deduplicate
  // Claude Code sometimes logs thinking/agent messages multiple times
  const seenAssistantMessages = new Set<string>();

  // Get cwd for path relativization
  const cwd = deriveWorkingDirectory(transcript);

  const addUserMessage = (
    id: string,
    timestamp: string | undefined,
    text: string,
    images: Array<{ sha256: string; mediaType: string }> = [],
    variant?: "steering",
  ) => {
    const dedupeKey = `${timestamp}:${text}`;
    const existing = seenUserMessages.get(dedupeKey);

    if (existing) {
      if (!existing.hasImages && images.length > 0) {
        const existingMsg = messages[existing.index] as Record<string, unknown>;
        existingMsg.images = images;
        existing.hasImages = true;
      }
      return;
    }

    const messageData: Record<string, unknown> = {
      type: "user",
      text,
      id,
      timestamp,
    };

    if (variant) {
      messageData.variant = variant;
    }

    if (images.length > 0) {
      messageData.images = images;
    }

    const msgIndex = messages.length;
    messages.push(unifiedTranscriptMessageSchema.parse(messageData));
    seenUserMessages.set(dedupeKey, { index: msgIndex, hasImages: images.length > 0 });
  };

  for (const record of transcript) {
    if (record.isMeta) {
      continue;
    }

    const metadata = buildMessageMetadata(record);
    const type = record.type;

    if (type === "attachment") {
      const queuedPrompt = extractQueuedCommandPrompt(record);
      if (queuedPrompt) {
        addUserMessage(record.uuid, metadata.timestamp, queuedPrompt, [], "steering");
      }
      continue;
    }

    if (type === "user") {
      const { texts, images, toolResults } = extractUserContent(record, blobs);

      for (const text of texts) {
        if (!text.trim()) {
          continue;
        }

        // Check if this is a local-command-stdout message
        const stdout = parseLocalCommandStdout(text);
        if (stdout !== null) {
          // Skip stdout from ignored commands (like /clear)
          if (skipNextStdout) {
            skipNextStdout = false;
            continue;
          }
          // If we have a pending command, merge stdout into it and emit
          if (pendingCommand) {
            const cleanedOutput = stripAnsiCodes(stdout).trim();
            messages.push(
              unifiedTranscriptMessageSchema.parse({
                type: "command",
                name: pendingCommand.name,
                args: pendingCommand.args,
                output: cleanedOutput || undefined,
                id: pendingCommand.id,
                timestamp: pendingCommand.timestamp,
              }),
            );
            pendingCommand = null;
          }
          // Skip this text (don't create a user message for it)
          continue;
        }

        // Check if this is a command-name message
        const parsedCommand = parseCommandMessage(text);
        if (parsedCommand) {
          // Skip ignored commands (like /clear) - they add no value to the transcript
          if (IGNORED_COMMANDS.has(parsedCommand.name)) {
            skipNextStdout = true;
            continue;
          }
          // If we had a pending command without stdout, emit it first
          if (pendingCommand) {
            messages.push(
              unifiedTranscriptMessageSchema.parse({
                type: "command",
                name: pendingCommand.name,
                args: pendingCommand.args,
                id: pendingCommand.id,
                timestamp: pendingCommand.timestamp,
              }),
            );
          }
          // Set as new pending command
          pendingCommand = {
            name: parsedCommand.name,
            args: parsedCommand.args,
            id: record.uuid,
            timestamp: metadata.timestamp,
          };
          continue;
        }

        // Strip system reminders from text
        const cleanedText = stripSystemReminders(text);
        if (!cleanedText) {
          continue;
        }

        const messageType = record.isCompactSummary ? "compaction-summary" : "user";

        if (messageType === "user") {
          addUserMessage(record.uuid, metadata.timestamp, cleanedText, images);
        } else {
          // Non-user message (compaction-summary)
          const messageData: Record<string, unknown> = {
            type: messageType,
            text: cleanedText,
            id: record.uuid,
            timestamp: metadata.timestamp,
          };

          messages.push(unifiedTranscriptMessageSchema.parse(messageData));
        }
      }

      // Merge tool results back into tool calls
      for (const result of toolResults) {
        const linkedTool = result.callId ? toolCallById.get(result.callId) : undefined;
        if (linkedTool) {
          // Update the existing tool call with output/error
          const toolCallMessage = messages[linkedTool.index] as (typeof messages)[number] & {
            type: "tool-call";
          };
          const sanitizedOutput = sanitizeImagesInValue(result.output, blobs);
          toolCallMessage.output = sanitizedOutput;

          // Extract images from sanitized output and add to message
          const outputImages = extractImageReferencesFromValue(sanitizedOutput);
          if (outputImages.length > 0) {
            (toolCallMessage as typeof toolCallMessage & { images?: typeof outputImages }).images = outputImages;
          }

          if (result.error) {
            toolCallMessage.error = result.error;
          }
          if (typeof result.isError !== "undefined") {
            (toolCallMessage as typeof toolCallMessage & Record<string, unknown>).isError = result.isError;
          }

          // Re-sanitize after adding output
          const sanitized = sanitizeToolCall(toolCallMessage, cwd);
          messages[linkedTool.index] = sanitized;
        }
      }

      continue;
    }

    if (type === "assistant") {
      const content = record.message?.content;
      if (!Array.isArray(content)) {
        continue;
      }

      for (const part of content) {
        if (!part || typeof part !== "object") {
          continue;
        }

        const partObj = part as Record<string, unknown>;
        if (partObj.type === "thinking" && typeof partObj.thinking === "string") {
          // Deduplicate thinking messages
          const dedupeKey = `thinking:${metadata.id}:${metadata.timestamp}:${partObj.thinking}`;
          if (seenAssistantMessages.has(dedupeKey)) {
            continue;
          }
          seenAssistantMessages.add(dedupeKey);

          messages.push(
            unifiedTranscriptMessageSchema.parse({
              type: "thinking",
              text: partObj.thinking,
              ...metadata,
            }),
          );
          continue;
        }

        if (partObj.type === "text" && typeof partObj.text === "string") {
          // Deduplicate agent messages
          const dedupeKey = `agent:${metadata.id}:${metadata.timestamp}:${partObj.text}`;
          if (seenAssistantMessages.has(dedupeKey)) {
            continue;
          }
          seenAssistantMessages.add(dedupeKey);

          messages.push(
            unifiedTranscriptMessageSchema.parse({
              type: "agent",
              text: partObj.text,
              ...metadata,
            }),
          );
          continue;
        }

        if (partObj.type === "tool_use") {
          const callId = typeof partObj.id === "string" ? partObj.id : "";
          const toolName = typeof partObj.name === "string" ? partObj.name : null;
          const input = partObj.input ?? undefined;

          // Build with type and toolName first for better readability
          const toolCallMessage = {
            type: "tool-call" as const,
            toolName,
            ...metadata,
            input,
          };

          const parsed = unifiedTranscriptMessageSchema.parse(toolCallMessage);
          const sanitized = sanitizeToolCall(parsed as UnifiedTranscriptMessage & { type: "tool-call" }, cwd);
          messages.push(sanitized);

          if (callId) {
            toolCallById.set(callId, { index: messages.length - 1, toolName });
          }
          continue;
        }

        if (partObj.type === "image") {
          continue;
        }
      }
    }
  }

  // Emit any remaining pending command
  if (pendingCommand) {
    messages.push(
      unifiedTranscriptMessageSchema.parse({
        type: "command",
        name: pendingCommand.name,
        args: pendingCommand.args,
        id: pendingCommand.id,
        timestamp: pendingCommand.timestamp,
      }),
    );
  }

  return { messages, blobs };
}

type ExtractedUserContent = {
  texts: string[];
  images: Array<{ sha256: string; mediaType: string }>;
  toolResults: Array<{
    callId?: string;
    toolName?: string | null;
    output?: unknown;
    error?: string;
    isError?: boolean;
  }>;
};

function extractUserContent(record: ClaudeMessageRecord, blobs: Map<string, TranscriptBlob>): ExtractedUserContent {
  const payload = record.message;
  if (!payload) {
    return { texts: [], images: [], toolResults: [] };
  }

  const content = payload.content;
  if (typeof content === "string") {
    return content ? { texts: [content], images: [], toolResults: [] } : { texts: [], images: [], toolResults: [] };
  }

  if (!Array.isArray(content)) {
    return { texts: [], images: [], toolResults: [] };
  }

  const texts: string[] = [];
  const images: ExtractedUserContent["images"] = [];
  const toolResults: ExtractedUserContent["toolResults"] = [];

  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }

    if (typeof part === "string") {
      if (part) {
        texts.push(part);
      }
      continue;
    }

    const recordPart = part as Record<string, unknown>;
    const type = typeof recordPart.type === "string" ? recordPart.type : undefined;

    if (type === "tool_result") {
      const recordPartObj = recordPart as Record<string, unknown>;
      const callId = typeof recordPartObj.tool_use_id === "string" ? (recordPartObj.tool_use_id as string) : undefined;
      let output: unknown = recordPartObj.content;

      const toolUseResult = (record.raw.toolUseResult ?? record.raw.tool_use_result) as
        | Record<string, unknown>
        | undefined;

      if (toolUseResult) {
        output = toolUseResult;
      }

      const error = typeof recordPartObj.error === "string" ? (recordPartObj.error as string) : undefined;
      const rawIsError =
        (recordPartObj as { is_error?: unknown }).is_error ?? (recordPartObj as { isError?: unknown }).isError;
      const isError =
        typeof rawIsError === "boolean"
          ? rawIsError
          : typeof (recordPartObj as { success?: unknown }).success === "boolean"
            ? !(recordPartObj as { success: boolean }).success
            : undefined;

      toolResults.push({
        callId,
        output,
        error,
        isError,
      });
      continue;
    }

    if (type === "text" && typeof recordPart.text === "string") {
      if (recordPart.text) {
        texts.push(recordPart.text);
      }
      continue;
    }

    if (type === "image") {
      const sanitized = sanitizeImagesInValue(recordPart, blobs);
      if (sanitized && typeof sanitized === "object" && (sanitized as Record<string, unknown>).type === "image") {
        const source = (sanitized as Record<string, unknown>).source as Record<string, unknown> | undefined;
        if (source?.type === "sha256" && typeof source.sha256 === "string") {
          images.push({
            sha256: source.sha256,
            mediaType: typeof source.mediaType === "string" ? source.mediaType : "image/unknown",
          });
        }
      }
      continue;
    }

    for (const key of ["content", "text"]) {
      const value = recordPart[key];
      if (typeof value === "string" && value) {
        texts.push(value);
      }
    }
  }

  return { texts, images, toolResults };
}

function buildMessageMetadata(record: ClaudeMessageRecord): {
  id?: string;
  timestamp?: string;
  model?: string;
} {
  return {
    id: record.message?.id,
    timestamp: record.timestamp,
    model: record.message?.model,
  };
}

/**
 * Sanitize tool call by converting absolute paths to relative paths
 * based on cwd for known file path fields
 */
function sanitizeToolCall(
  toolCall: UnifiedTranscriptMessage & { type: "tool-call" },
  cwd: string | undefined,
): UnifiedTranscriptMessage {
  if (!cwd) {
    return toolCall;
  }

  // Normalize cwd to ensure it ends with /
  const normalizedCwd = cwd.endsWith("/") ? cwd : `${cwd}/`;

  // Helper to convert absolute path to relative
  const toRelative = (absPath: string): string => {
    if (absPath.startsWith(normalizedCwd)) {
      const relativePath = absPath.slice(normalizedCwd.length);
      return `./${relativePath}`;
    }
    return absPath;
  };

  const isPlainObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

  const cloneObject = (value: unknown): Record<string, unknown> | undefined =>
    isPlainObject(value) ? { ...value } : undefined;

  const removeKeys = (source: Record<string, unknown>, keys: string[]): Record<string, unknown> => {
    const copy = { ...source };
    for (const key of keys) {
      delete copy[key];
    }
    return copy;
  };

  const ensureRelativePath = (obj: Record<string, unknown>, key: string) => {
    if (typeof obj[key] === "string") {
      obj[key] = toRelative(obj[key] as string);
    }
  };

  const toNumber = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? (value as number) : 0;

  const stripActiveForm = (value: unknown): unknown => {
    if (!Array.isArray(value)) {
      return value;
    }
    return value.map((item) => {
      if (isPlainObject(item)) {
        const nextItem = { ...item };
        delete nextItem.activeForm;
        return nextItem;
      }
      return item;
    });
  };

  const { toolName, input, output } = toolCall;

  let sanitizedInput: unknown = input;
  let sanitizedOutput: unknown = output;
  let inputChanged = false;
  let outputChanged = false;
  let isErrorValue = (toolCall as Record<string, unknown>).isError;

  switch (toolName) {
    case "Write": {
      const inputObj = cloneObject(input);
      if (inputObj) {
        ensureRelativePath(inputObj, "file_path");
        sanitizedInput = inputObj;
        inputChanged = true;
      }

      const outputObj = cloneObject(output);
      if (outputObj) {
        const next: Record<string, unknown> = {};
        if (outputObj.type !== undefined) {
          next.type = outputObj.type;
        }
        sanitizedOutput = next;
        outputChanged = true;
      }
      break;
    }

    case "Read": {
      const inputObj = cloneObject(input);
      if (inputObj) {
        ensureRelativePath(inputObj, "file_path");
        sanitizedInput = inputObj;
        inputChanged = true;
      }

      const outputObj = cloneObject(output);
      if (outputObj) {
        const next: Record<string, unknown> = {};
        if (typeof outputObj.type === "string") {
          next.type = outputObj.type;
        }

        if (outputObj.file && isPlainObject(outputObj.file)) {
          const fileObj = outputObj.file as Record<string, unknown>;
          const file: Record<string, unknown> = {};
          if (typeof fileObj.content === "string") {
            file.content = fileObj.content;
          }
          if (typeof fileObj.numLines === "number") {
            file.numLines = fileObj.numLines;
          }
          if (typeof fileObj.startLine === "number") {
            file.startLine = fileObj.startLine;
          }
          if (typeof fileObj.totalLines === "number") {
            file.totalLines = fileObj.totalLines;
          }
          if (Object.keys(file).length > 0) {
            next.file = file;
          }
        }

        sanitizedOutput = next;
        outputChanged = true;
      }
      break;
    }

    case "Edit": {
      const inputObj = cloneObject(input);
      const outputObj = cloneObject(output);

      let diffString: string | undefined;
      let lineOffset: number | undefined;

      // Extract line offset from structuredPatch if available
      if (outputObj && Array.isArray(outputObj.structuredPatch)) {
        const diffLines: string[] = [];
        for (const hunk of outputObj.structuredPatch as unknown[]) {
          if (isPlainObject(hunk)) {
            // Extract line offset from first hunk
            if (lineOffset === undefined && typeof hunk.oldStart === "number") {
              lineOffset = hunk.oldStart;
            }
            if (Array.isArray(hunk.lines)) {
              for (const line of hunk.lines as unknown[]) {
                if (typeof line === "string") {
                  diffLines.push(line);
                }
              }
            }
          }
        }
        if (diffLines.length > 0) {
          diffString = `${diffLines.join("\n")}\n`;
        }
      }

      // Extract line offset from string output containing cat -n format
      // Format: "The file ... has been updated. Here's the result of running `cat -n`...\n    94→content"
      if (lineOffset === undefined && typeof output === "string") {
        const catNLineMatch = output.match(/^\s*(\d+)[→\t]/m);
        if (catNLineMatch) {
          lineOffset = parseInt(catNLineMatch[1], 10);
        }
      }

      if (inputObj) {
        ensureRelativePath(inputObj, "file_path");
        const legacyOld =
          typeof inputObj.old_string === "string"
            ? (inputObj.old_string as string)
            : typeof inputObj.oldString === "string"
              ? (inputObj.oldString as string)
              : undefined;
        const legacyNew =
          typeof inputObj.new_string === "string"
            ? (inputObj.new_string as string)
            : typeof inputObj.newString === "string"
              ? (inputObj.newString as string)
              : undefined;

        const isErrorLike =
          isErrorValue === true ||
          isErrorValue === "true" ||
          (typeof output === "string" && !output.includes("has been updated")) ||
          (outputObj && typeof outputObj.type === "string" && outputObj.type === "error");

        if (!diffString && !isErrorLike && legacyOld !== undefined && legacyNew !== undefined) {
          const oldLines = legacyOld.split("\n");
          const newLines = legacyNew.split("\n");
          const diffParts: string[] = [];
          for (const line of oldLines) {
            diffParts.push(`-${line}`);
          }
          for (const line of newLines) {
            diffParts.push(`+${line}`);
          }
          diffString = `${diffParts.join("\n")}\n`;
        }

        delete inputObj.old_string;
        delete inputObj.new_string;
        delete inputObj.oldString;
        delete inputObj.newString;

        if (diffString) {
          inputObj.diff = diffString;
        }

        if (lineOffset !== undefined && lineOffset > 0) {
          inputObj.lineOffset = lineOffset;
        }

        sanitizedInput = inputObj;
        inputChanged = true;
      }

      if (outputObj) {
        const reduced = removeKeys(outputObj, [
          "filePath",
          "newString",
          "oldString",
          "originalFile",
          "structuredPatch",
          "replaceAll",
        ]);
        sanitizedOutput = Object.keys(reduced).length > 0 ? reduced : undefined;
        outputChanged = true;
      }
      break;
    }

    case "Glob":
    case "Grep": {
      const outputObj = cloneObject(output);
      if (outputObj && Array.isArray(outputObj.filenames)) {
        outputObj.filenames = (outputObj.filenames as unknown[]).map((filename) =>
          typeof filename === "string" ? toRelative(filename) : filename,
        );
        delete outputObj.numFiles;
        sanitizedOutput = outputObj;
        outputChanged = true;
      }
      break;
    }

    case "Bash": {
      const inputObj = cloneObject(input);
      if (inputObj && typeof inputObj.command === "string") {
        // Strip shell wrappers like "bash -lc '...'" or "zsh -lc '...'"
        const shellWrapperMatch = inputObj.command.match(/^(?:bash|zsh)\s+-lc\s+['"](.*)['"]$/s);
        if (shellWrapperMatch) {
          inputObj.command = shellWrapperMatch[1];
        }
        sanitizedInput = inputObj;
        inputChanged = true;
      }

      const outputObj = cloneObject(output);
      if (outputObj) {
        delete outputObj.stdoutLines;
        delete outputObj.stderrLines;
        sanitizedOutput = outputObj;
        outputChanged = true;
      }
      break;
    }

    case "Task": {
      const inputObj = cloneObject(input);
      if (inputObj) {
        sanitizedInput = inputObj;
        inputChanged = true;
      }

      const outputObj = cloneObject(output);
      if (outputObj) {
        const next: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(outputObj)) {
          if (key === "usage" && isPlainObject(value)) {
            const usageRecord = value as Record<string, unknown>;
            const inputTokens = toNumber(usageRecord.input_tokens ?? usageRecord.inputTokens);
            const cachedInputTokens =
              toNumber(usageRecord.cached_input_tokens ?? usageRecord.cachedInputTokens) +
              toNumber(usageRecord.cache_creation_input_tokens ?? usageRecord.cacheCreationInputTokens) +
              toNumber(usageRecord.cache_read_input_tokens ?? usageRecord.cacheReadInputTokens);
            const outputTokens = toNumber(usageRecord.output_tokens ?? usageRecord.outputTokens);
            const reasoningOutputTokens = toNumber(
              usageRecord.reasoning_output_tokens ?? usageRecord.reasoningOutputTokens,
            );
            const totalTokensSource = usageRecord.total_tokens ?? usageRecord.totalTokens;
            const totalTokens =
              typeof totalTokensSource === "number" && Number.isFinite(totalTokensSource)
                ? (totalTokensSource as number)
                : inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens;

            next.usage = {
              inputTokens,
              cachedInputTokens,
              outputTokens,
              reasoningOutputTokens,
              totalTokens,
            };
            continue;
          }

          if (key === "usage" || key === "totalTokens" || key === "prompt") {
            continue;
          }

          next[key] = value;
        }

        sanitizedOutput = next;
        outputChanged = true;
      }
      break;
    }

    case "TodoWrite": {
      const inputObj = cloneObject(input);
      if (inputObj) {
        if (Array.isArray((inputObj as any).todos)) {
          (inputObj as any).todos = stripActiveForm((inputObj as any).todos);
        }
        sanitizedInput = inputObj;
        inputChanged = true;
      }

      const outputObj = cloneObject(output);
      if (outputObj) {
        const next = { ...outputObj };
        let changed = false;
        if (Array.isArray((next as any).newTodos)) {
          (next as any).newTodos = stripActiveForm((next as any).newTodos);
          changed = true;
        }
        if (Array.isArray((next as any).oldTodos)) {
          (next as any).oldTodos = stripActiveForm((next as any).oldTodos);
          changed = true;
        }
        sanitizedOutput = changed ? next : outputObj;
        outputChanged = changed;
      }
      break;
    }

    case "BashOutput": {
      const outputObj = cloneObject(output);
      if (outputObj) {
        delete outputObj.stdoutLines;
        delete outputObj.stderrLines;
        sanitizedOutput = outputObj;
        outputChanged = true;
      }
      break;
    }

    default:
      break;
  }

  if (toolName === "KillShell" && typeof isErrorValue === "boolean") {
    isErrorValue = String(isErrorValue);
  }

  const nextCall: Record<string, unknown> = {
    ...toolCall,
  };

  // Apply generic path relativization to both input and output
  // This catches any paths missed by tool-specific handling
  if (sanitizedInput !== undefined) {
    sanitizedInput = relativizePaths(sanitizedInput, cwd);
  }
  if (sanitizedOutput !== undefined) {
    sanitizedOutput = relativizePaths(sanitizedOutput, cwd);
  }

  if (inputChanged || sanitizedInput !== input) {
    if (typeof sanitizedInput === "undefined") {
      delete nextCall.input;
    } else {
      nextCall.input = sanitizedInput;
    }
  }

  if (outputChanged || sanitizedOutput !== output) {
    if (typeof sanitizedOutput === "undefined") {
      delete nextCall.output;
    } else {
      nextCall.output = sanitizedOutput;
    }
  }

  if (typeof isErrorValue === "undefined") {
    if (typeof nextCall.error === "string" && nextCall.error.trim()) {
      isErrorValue = true;
    } else if (typeof sanitizedOutput === "string" && /^error:/i.test(sanitizedOutput.trim())) {
      isErrorValue = true;
    }
  }

  if (typeof isErrorValue !== "undefined") {
    nextCall.isError = isErrorValue;
  }

  const orderedCall: Record<string, unknown> = {};
  const preferredOrder = ["id", "input", "model", "output", "timestamp", "toolName", "error", "isError", "type"];

  for (const key of preferredOrder) {
    if (Object.prototype.hasOwnProperty.call(nextCall, key)) {
      orderedCall[key] = nextCall[key];
    }
  }

  for (const key of Object.keys(nextCall)) {
    if (!Object.prototype.hasOwnProperty.call(orderedCall, key)) {
      orderedCall[key] = nextCall[key];
    }
  }

  const parsedSanitized = toolCallMessageWithShapesSchema.parse(orderedCall);
  return parsedSanitized as UnifiedTranscriptMessage;
}
