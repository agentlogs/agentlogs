import { createHash } from "node:crypto";
import {
  convertOpenCodeTranscript,
  type OpenCodeMessage,
  type OpenCodeSession,
  type UnifiedGitContext,
} from "@vibeinsights/shared";
import { LiteLLMPricingFetcher } from "@vibeinsights/shared/pricing";
import { uploadTranscript, type UploadOptions } from "@vibeinsights/shared/upload";

export interface UploadResult {
  success: boolean;
  transcriptId?: string;
  transcriptUrl?: string;
  error?: string;
}

export interface UploadParams {
  session: OpenCodeSession;
  messages: OpenCodeMessage[];
  gitContext: UnifiedGitContext;
  cwd: string;
  serverUrl?: string;
  authToken?: string;
}

/**
 * Upload an OpenCode transcript to Vibe Insights.
 */
export async function uploadOpenCodeTranscript(params: UploadParams): Promise<UploadResult> {
  const { session, messages, gitContext, cwd, serverUrl, authToken } = params;

  try {
    // Fetch pricing data for cost calculation
    const pricingFetcher = new LiteLLMPricingFetcher();
    const pricingData = await pricingFetcher.fetchModelPricing();
    const pricing = Object.fromEntries(pricingData);

    // Convert to unified format
    const unifiedTranscript = convertOpenCodeTranscript(session, messages, {
      gitContext,
      cwd,
      pricing,
    });

    if (!unifiedTranscript) {
      return {
        success: false,
        error: "Failed to convert transcript to unified format",
      };
    }

    // Create raw transcript representation for upload
    const rawTranscript = createRawTranscript(session, messages);
    const sha256 = createHash("sha256").update(rawTranscript).digest("hex");

    // Upload to server
    const uploadOptions: UploadOptions = {
      serverUrl: serverUrl ?? process.env.VI_SERVER_URL ?? process.env.VIBEINSIGHTS_BASE_URL,
      authToken: authToken ?? process.env.VI_AUTH_TOKEN ?? process.env.VIBEINSIGHTS_AUTH_TOKEN,
    };

    const result = await uploadTranscript(
      {
        sha256,
        rawTranscript,
        unifiedTranscript,
      },
      uploadOptions,
    );

    if (result.success && result.transcriptId) {
      const baseUrl = uploadOptions.serverUrl ?? "https://vibeinsights.dev";
      return {
        success: true,
        transcriptId: result.transcriptId,
        transcriptUrl: `${baseUrl}/transcripts/${result.transcriptId}`,
      };
    }

    return {
      success: false,
      error: "Upload failed",
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Create a raw transcript representation from OpenCode session/messages.
 * This creates a JSONL-like format for storage.
 */
function createRawTranscript(session: OpenCodeSession, messages: OpenCodeMessage[]): string {
  const lines: string[] = [];

  // Add session metadata
  lines.push(JSON.stringify({ type: "session", ...session }));

  // Add each message
  for (const message of messages) {
    lines.push(JSON.stringify({ type: "message", ...message }));
  }

  return lines.join("\n");
}

/**
 * Build transcript URL from server URL and transcript ID.
 */
export function buildTranscriptUrl(transcriptId: string, serverUrl?: string): string {
  const baseUrl = serverUrl ?? process.env.VI_SERVER_URL ?? "https://vibeinsights.dev";
  return `${baseUrl}/transcripts/${transcriptId}`;
}
