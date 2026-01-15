import { createRpcClient } from "./rpc-client";
import type { TranscriptMetadata } from "./types";

const DEFAULT_SERVER_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface FetchTranscriptMetadataOptions {
  serverUrl?: string;
  authToken?: string;
  timeoutMs?: number;
}

export async function fetchTranscriptMetadata(
  options: FetchTranscriptMetadataOptions = {},
): Promise<TranscriptMetadata[]> {
  const serverUrl = options.serverUrl ?? process.env.VI_SERVER_URL ?? DEFAULT_SERVER_URL;
  const authToken = options.authToken ?? null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  try {
    const client = createRpcClient({
      serverUrl,
      authToken,
      timeoutMs,
    });

    const result = await client.transcripts.list();

    // Map the oRPC response to TranscriptMetadata format
    return result.transcripts.map((t) => ({
      transcriptId: t.transcriptId,
      sha256: t.sha256,
      repoId: t.repoId,
    }));
  } catch (error) {
    if (error instanceof Error) {
      console.error("Failed to fetch transcript metadata:", error.message);
    }
    return [];
  }
}
