import { createHash } from "node:crypto";
import { convertOpenCodeTranscript, type OpenCodeExport, type UnifiedGitContext } from "@agentlogs/shared";
import { LiteLLMPricingFetcher } from "@agentlogs/shared/pricing";
import { uploadTranscript, type UploadOptions } from "@agentlogs/shared/upload";

export interface UploadResult {
  success: boolean;
  transcriptId?: string;
  transcriptUrl?: string;
  error?: string;
}

export interface UploadParams {
  /** The OpenCode export data (from `opencode export <sessionID>`) */
  exportData: OpenCodeExport;
  gitContext: UnifiedGitContext;
  cwd: string;
  serverUrl?: string;
  authToken?: string;
}

/**
 * Upload an OpenCode transcript to AgentLogs.
 */
export async function uploadOpenCodeTranscript(params: UploadParams): Promise<UploadResult> {
  const { exportData, gitContext, cwd, serverUrl, authToken } = params;

  try {
    // Fetch pricing data for cost calculation
    const pricingFetcher = new LiteLLMPricingFetcher();
    const pricingData = await pricingFetcher.fetchModelPricing();
    const pricing = Object.fromEntries(pricingData);

    // Convert to unified format
    const unifiedTranscript = convertOpenCodeTranscript(exportData, {
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
    const rawTranscript = JSON.stringify(exportData);
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
      const baseUrl = uploadOptions.serverUrl ?? "https://agentlogs.ai";
      return {
        success: true,
        transcriptId: result.transcriptId,
        transcriptUrl: `${baseUrl}/app/logs/${result.transcriptId}`,
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
 * Build transcript URL from server URL and transcript ID.
 */
export function buildTranscriptUrl(transcriptId: string, serverUrl?: string): string {
  const baseUrl = serverUrl ?? process.env.VI_SERVER_URL ?? "https://agentlogs.ai";
  return `${baseUrl}/app/logs/${transcriptId}`;
}
