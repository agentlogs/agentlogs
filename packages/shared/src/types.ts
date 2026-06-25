// API Payloads

import type { UnifiedTranscript } from "./claudecode";

export type TranscriptSource = "claude-code" | "cline" | "codex" | "opencode" | "openclaw" | "pi";

/**
 * Blob data ready for upload (binary + metadata)
 */
export interface UploadBlob {
  sha256: string;
  data: Uint8Array;
  mediaType: string;
}

/** Visibility setting for transcripts */
export type TranscriptVisibility = "private" | "team" | "public";

export interface UploadPayload {
  /** Client-generated CUID2 ID for stable links */
  id?: string;
  sha256: string;
  unifiedTranscript: UnifiedTranscript;
  /** Blobs (images/screenshots) extracted from the transcript */
  blobs?: UploadBlob[];
  /** Visibility override - if not set, server decides based on repo visibility */
  visibility?: TranscriptVisibility;
}

export interface UploadResponse {
  success: boolean;
  /** The database ID (CUID2) for stable links */
  id: string;
  transcriptId: string;
  eventsReceived: number;
}

export interface TranscriptMetadata {
  transcriptId: string;
  sha256: string;
  repoId: string | null;
}
