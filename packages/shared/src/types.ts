// API Payloads

import type { UnifiedTranscript } from "./claudecode";

export type TranscriptSource = "claude-code" | "codex";

/**
 * Blob data ready for upload (binary + metadata)
 */
export interface UploadBlob {
  sha256: string;
  data: Uint8Array;
  mediaType: string;
}

export interface UploadPayload {
  sha256: string;
  rawTranscript: string;
  unifiedTranscript: UnifiedTranscript;
  /** Blobs (images/screenshots) extracted from the transcript */
  blobs?: UploadBlob[];
}

export interface UploadResponse {
  success: boolean;
  transcriptId: string;
  eventsReceived: number;
}

export interface TranscriptMetadata {
  transcriptId: string;
  sha256: string;
  repoId: string | null;
}
