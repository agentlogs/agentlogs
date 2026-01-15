/**
 * Contract types for oRPC router.
 * These types are used by clients to get type-safe access to the API.
 * Defined in shared so both web (server) and CLI (client) can use them.
 */

export interface TranscriptListResult {
  transcripts: {
    transcriptId: string;
    sha256: string;
    repoId: string;
  }[];
}

export interface CommitTrackInput {
  sessionId: string;
  repoPath: string;
  timestamp: string;
}

export interface CommitTrackResult {
  success: boolean;
}

/**
 * Contract type for the oRPC router.
 * This is a simplified type definition that matches the router structure.
 */
export interface RouterContract {
  transcripts: {
    list: () => Promise<TranscriptListResult>;
  };
  commitTrack: {
    create: (input: CommitTrackInput) => Promise<CommitTrackResult>;
  };
}
