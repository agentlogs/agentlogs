import type { InferInsertModel } from "drizzle-orm";
import * as schema from "../../server/src/db/schema";

type TranscriptInsert = InferInsertModel<typeof schema.transcripts>;
type RepoInsert = InferInsertModel<typeof schema.repos>;

/**
 * Create transcript test data with a unique test ID.
 * The testId is used to create unique identifiers that can be queried in tests.
 */
export function createTranscript(testId: string, overrides?: Partial<TranscriptInsert>): TranscriptInsert {
  return {
    id: `transcript-${testId}`,
    userId: "test-user-id",
    sha256: crypto.randomUUID().replace(/-/g, ""),
    transcriptId: `tid-${testId}`,
    source: "claude-code",
    preview: `Test transcript ${testId}`,
    model: "claude-sonnet-4-5-20250929",
    costUsd: 0.01,
    blendedTokens: 1000,
    messageCount: 5,
    totalTokens: 1000,
    inputTokens: 800,
    cachedInputTokens: 500,
    outputTokens: 200,
    reasoningOutputTokens: 0,
    cwd: "/Users/test/project",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

/**
 * Create repo test data with a unique test ID.
 */
export function createRepo(testId: string, overrides?: Partial<RepoInsert>): RepoInsert {
  return {
    id: `repo-${testId}`,
    repo: `github.com/test/repo-${testId}`,
    lastActivity: new Date().toISOString(),
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Generate a short unique test ID for use in test data.
 */
export function testId(): string {
  return crypto.randomUUID().slice(0, 8);
}
