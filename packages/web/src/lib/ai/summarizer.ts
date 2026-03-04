import { createOpenRouter } from "@openrouter/ai-sdk-provider";
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

export interface SummarizerOptions {
  model?: string;
}

export interface SummaryResult {
  summary: string;
  model: string;
  promptTokens?: number;
  completionTokens?: number;
}

function getApiKey(): string | undefined {
  return (env as unknown as Record<string, unknown>).OPENROUTER_API_KEY as string | undefined;
}

function isTestEnvironment(): boolean {
  // Check for e2e test environment (set by start-test-server.ts)
  return import.meta.env.VITE_USE_TEST_DB === "true";
}

/**
 * Generate a short summary/title for a coding conversation
 * using a lightweight LLM via OpenRouter.
 *
 * Returns a stub value in test environments or when OPENROUTER_API_KEY is not configured.
 */
export async function generateSummary(userPrompt: string, options: SummarizerOptions = {}): Promise<SummaryResult> {
  // Skip AI generation in test environment
  if (isTestEnvironment()) {
    return {
      summary: "AI generated summary",
      model: "stub",
    };
  }

  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      summary: "AI generated summary",
      model: "stub",
    };
  }

  const modelId = options.model ?? "google/gemini-3-flash-preview";

  const openrouter = createOpenRouter({ apiKey });
  const model = openrouter(modelId);

  const prompt = SUMMARIZE_PROMPT.replace("{prompt}", userPrompt.trim());

  const result = await generateText({
    model,
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
    model: modelId,
    promptTokens: usage?.promptTokens,
    completionTokens: usage?.completionTokens,
  };
}
