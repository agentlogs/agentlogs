import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import { env } from "@/lib/env";

const SUMMARIZE_PROMPT = `Write a 3-6 word title for this coding task. No colons, no articles (a/an/the) at start. Title case.

Examples:
- "Fix GitHub OAuth Login Bug"
- "Add Dark Mode to Settings"
- "Refactor Database Query Layer"
- "Investigate CI Build Failures"

Task: "{prompt}"

Title:`;

export interface SummaryResult {
  summary: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

const DEFAULT_OPENROUTER_MODEL = "google/gemini-3-flash-preview";

function getAIConfig(): { model: Parameters<typeof generateText>[0]["model"]; modelId: string } | null {
  const aiBaseUrl = (env as unknown as Record<string, unknown>).AI_BASE_URL as string | undefined;
  const aiApiKey = (env as unknown as Record<string, unknown>).AI_API_KEY as string | undefined;
  const aiModel = (env as unknown as Record<string, unknown>).AI_MODEL as string | undefined;

  // Prefer AI_BASE_URL (OpenAI-compatible endpoint, e.g. Ollama, vLLM)
  // Use .chat() to force /v1/chat/completions (not /v1/responses which most providers don't support)
  if (aiBaseUrl && aiModel) {
    const provider = createOpenAI({
      baseURL: aiBaseUrl,
      apiKey: aiApiKey || "no-key-required",
    });
    return { model: provider.chat(aiModel), modelId: aiModel };
  }

  // Fall back to OpenRouter
  const openrouterKey = (env as unknown as Record<string, unknown>).OPENROUTER_API_KEY as string | undefined;
  if (openrouterKey) {
    const provider = createOpenRouter({ apiKey: openrouterKey });
    return { model: provider(DEFAULT_OPENROUTER_MODEL), modelId: DEFAULT_OPENROUTER_MODEL };
  }

  return null;
}

function isTestEnvironment(): boolean {
  // Check for e2e test environment (set by start-test-server.ts)
  return import.meta.env.VITE_USE_TEST_DB === "true";
}

/**
 * Generate a short summary/title for a coding conversation
 * using a lightweight LLM.
 *
 * Supports two backends:
 * 1. Any OpenAI-compatible API (Ollama, vLLM, etc.) via AI_BASE_URL + AI_MODEL + optional AI_API_KEY
 * 2. OpenRouter via OPENROUTER_API_KEY (uses google/gemini-3-flash-preview)
 *
 * Returns a stub value in test environments or when no AI backend is configured.
 */
export async function generateSummary(userPrompt: string): Promise<SummaryResult> {
  // Skip AI generation in test environment
  if (isTestEnvironment()) {
    return {
      summary: "AI generated summary",
      model: "stub",
    };
  }

  const config = getAIConfig();
  if (!config) {
    return {
      summary: "AI generated summary",
      model: "stub",
    };
  }

  const prompt = SUMMARIZE_PROMPT.replace("{prompt}", userPrompt.trim());

  const result = await generateText({
    model: config.model,
    prompt,
    maxTokens: 50,
    temperature: 0.3,
  } as Parameters<typeof generateText>[0]);

  // Clean up the response - remove quotes, trim whitespace
  const summary = result.text
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usage = result.usage as any;
  return {
    summary,
    model: config.modelId,
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
  };
}
