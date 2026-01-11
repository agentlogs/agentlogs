import path from "node:path";
import type { UnifiedGitContext, UnifiedTokenUsage, UnifiedTranscript, UnifiedTranscriptMessage } from "./claudecode";
import { formatCwdWithTilde } from "./paths";
import type { LiteLLMModelPricing } from "./pricing";
import {
  unifiedGitContextSchema,
  unifiedModelUsageSchema,
  unifiedTranscriptMessageSchema,
  unifiedTranscriptSchema,
} from "./schemas";

// ============================================================================
// OpenCode Types
// ============================================================================

export type OpenCodeSession = {
  id: string;
  parentSessionId?: string | null;
  title?: string | null;
  messageCount?: number;
  promptTokens?: number;
  completionTokens?: number;
  cost?: number;
  createdAt: string;
  updatedAt?: string;
};

export type OpenCodeMessage = {
  id: string;
  sessionId: string;
  role: "user" | "assistant";
  parts: OpenCodePart[];
  model?: string | null;
  createdAt: string;
  updatedAt?: string;
  finishedAt?: string | null;
};

export type OpenCodeToolState = {
  input?: unknown;
  output?: unknown;
  error?: string;
  status?: "pending" | "running" | "completed" | "error";
};

export type OpenCodePart =
  | { type: "text"; text: string }
  | { type: "tool"; id: string; name: string; state?: OpenCodeToolState }
  | { type: "reasoning"; text: string }
  | { type: "compaction"; summary: string }
  | { type: "file"; url: string; mime: string };

export type ConvertOpenCodeOptions = {
  now?: Date;
  gitContext?: UnifiedGitContext | null;
  cwd?: string | null;
  pricing?: Record<string, LiteLLMModelPricing>;
};

// ============================================================================
// Tool Name Mapping
// ============================================================================

const TOOL_NAME_MAP: Record<string, string> = {
  // OpenCode built-in tools → Unified names
  shell: "Bash",
  bash: "Bash",
  read_file: "Read",
  read: "Read",
  write_file: "Write",
  write: "Write",
  edit_file: "Edit",
  edit: "Edit",
  glob: "Glob",
  grep: "Grep",
  find: "Glob",
  list_files: "Glob",
  // MCP and other tools keep their names
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
 * Convert an OpenCode session and messages to a unified transcript.
 */
export function convertOpenCodeTranscript(
  session: OpenCodeSession,
  messages: OpenCodeMessage[],
  options: ConvertOpenCodeOptions = {},
): UnifiedTranscript | null {
  if (messages.length === 0) {
    return null;
  }

  const cwd = options.cwd ?? null;
  const unifiedMessages: UnifiedTranscriptMessage[] = [];
  const userTexts: string[] = [];
  let primaryModel: string | null = null;

  // Sort messages by creation time
  const sortedMessages = [...messages].sort((a, b) => {
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  for (const message of sortedMessages) {
    // Track primary model from assistant messages
    if (message.role === "assistant" && message.model && !primaryModel) {
      primaryModel = message.model;
    }

    for (const part of message.parts) {
      const timestamp = message.createdAt;
      const model = message.role === "assistant" ? (message.model ?? undefined) : undefined;

      switch (part.type) {
        case "text": {
          const text = collapseWhitespace(part.text);
          if (!text) break;

          if (message.role === "user") {
            userTexts.push(text);
            unifiedMessages.push(
              unifiedTranscriptMessageSchema.parse({
                type: "user",
                text,
                id: message.id,
                timestamp,
              }),
            );
          } else {
            unifiedMessages.push(
              unifiedTranscriptMessageSchema.parse({
                type: "agent",
                text,
                id: message.id,
                timestamp,
                model,
              }),
            );
          }
          break;
        }

        case "reasoning": {
          const text = collapseWhitespace(part.text);
          if (!text) break;

          unifiedMessages.push(
            unifiedTranscriptMessageSchema.parse({
              type: "thinking",
              text,
              timestamp,
              model,
            }),
          );
          break;
        }

        case "tool": {
          const toolName = normalizeToolName(part.name);
          const state = part.state ?? {};

          const sanitizedInput = sanitizeToolInput(toolName, state.input, cwd);
          const sanitizedOutput = sanitizeToolOutput(toolName, state.output, cwd);

          unifiedMessages.push(
            unifiedTranscriptMessageSchema.parse({
              type: "tool-call",
              id: part.id,
              timestamp,
              model,
              toolName,
              input: sanitizedInput,
              output: sanitizedOutput,
              error: state.error,
              isError: state.status === "error" || !!state.error,
            }),
          );
          break;
        }

        case "compaction": {
          const text = collapseWhitespace(part.summary);
          if (!text) break;

          unifiedMessages.push(
            unifiedTranscriptMessageSchema.parse({
              type: "compaction-summary",
              text,
              timestamp,
            }),
          );
          break;
        }

        case "file": {
          // Skip file/image parts - not supported in current schema
          break;
        }
      }
    }
  }

  if (unifiedMessages.length === 0) {
    return null;
  }

  // Build token usage from session metadata
  const tokenUsage: UnifiedTokenUsage = {
    inputTokens: session.promptTokens ?? 0,
    cachedInputTokens: 0, // OpenCode doesn't expose cache tokens yet
    outputTokens: session.completionTokens ?? 0,
    reasoningOutputTokens: 0, // Would need to extract from reasoning parts
    totalTokens: (session.promptTokens ?? 0) + (session.completionTokens ?? 0),
  };

  const blendedTokens = tokenUsage.inputTokens + tokenUsage.outputTokens;
  const costUsd = session.cost ?? calculateCostFromUsage(primaryModel, tokenUsage, options.pricing);

  const timestamp = parseDate(session.createdAt) ?? options.now ?? new Date();
  const preview = derivePreview(userTexts);

  const gitContext =
    options.gitContext !== undefined
      ? options.gitContext
      : unifiedGitContextSchema.parse({
          repo: null,
          branch: null,
          relativeCwd: null,
        });

  const formattedCwd = cwd ? formatCwdWithTilde(cwd) : null;

  const transcript: UnifiedTranscript = unifiedTranscriptSchema.parse({
    v: 1 as const,
    id: session.id,
    source: "opencode" as const,
    timestamp,
    preview,
    model: primaryModel,
    blendedTokens,
    costUsd,
    messageCount: unifiedMessages.length,
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
// Helper Functions
// ============================================================================

function normalizeToolName(name: string): string {
  const lower = name.toLowerCase();
  return TOOL_NAME_MAP[lower] ?? name;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function derivePreview(userTexts: string[]): string | null {
  for (const text of userTexts) {
    const trimmed = text.trim();
    if (!trimmed) continue;
    // Skip system-like messages
    if (trimmed.startsWith("<") && trimmed.includes(">")) continue;
    return truncate(trimmed, 80);
  }
  return userTexts.length > 0 ? truncate(userTexts[0], 80) : null;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  if (maxLength <= 1) return value.slice(0, maxLength);
  return `${value.slice(0, maxLength - 1)}…`;
}

// ============================================================================
// Tool Input/Output Sanitization
// ============================================================================

function sanitizeToolInput(toolName: string, input: unknown, cwd: string | null): unknown {
  if (!input || typeof input !== "object") return input;

  const record = { ...(input as Record<string, unknown>) };

  // Relativize file paths
  if (typeof record.file_path === "string" && cwd) {
    record.file_path = relativizePath(record.file_path, cwd);
  }
  if (typeof record.path === "string" && cwd) {
    record.path = relativizePath(record.path, cwd);
  }
  if (typeof record.workdir === "string" && cwd) {
    record.workdir = relativizePath(record.workdir, cwd);
  }

  return record;
}

function sanitizeToolOutput(toolName: string, output: unknown, _cwd: string | null): unknown {
  if (!output) return output;

  // Shell/Bash output normalization
  if (toolName === "Bash" && typeof output === "object") {
    const record = output as Record<string, unknown>;
    const result: Record<string, unknown> = {};

    if (typeof record.stdout === "string") {
      result.stdout = record.stdout;
    } else if (typeof record.output === "string") {
      result.stdout = record.output;
    }
    if (typeof record.stderr === "string") {
      result.stderr = record.stderr;
    }
    if (typeof record.exitCode === "number" || typeof record.exit_code === "number") {
      result.exitCode = record.exitCode ?? record.exit_code;
    }

    return Object.keys(result).length > 0 ? result : undefined;
  }

  return output;
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
