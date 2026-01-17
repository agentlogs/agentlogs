import { createDrizzle, type DrizzleDB } from "@/db";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import type { TranscriptSource } from "@agentlogs/shared";
import { unifiedTranscriptSchema } from "@agentlogs/shared/schemas";
import * as Sentry from "@sentry/cloudflare";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { blobs, repos, teamMembers, transcriptBlobs, transcripts, type VisibilityOption } from "../../db/schema";
import { createAuth } from "../../lib/auth";
import { generateSummary } from "../../lib/ai/summarizer";
import { checkRepoIsPublic } from "../../lib/github";
import { logger } from "../../lib/logger";

export const Route = createFileRoute("/api/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return Sentry.startSpan({ name: "ingest.transcript", op: "http.server" }, async () => {
          const db = createDrizzle(env.DB);
          const auth = createAuth();

          logger.debug("Ingest request received");

          const session = await Sentry.startSpan({ name: "auth.getSession", op: "auth" }, () =>
            auth.api.getSession({ headers: request.headers }),
          );

          if (!session?.user) {
            logger.warn("Ingest auth failed: no session");
            return json({ error: "Unauthorized" }, { status: 401 });
          }

          const userId = session.user.id;
          Sentry.setUser({ id: userId });

          // Parse multipart form data (raw transcript upload)
          const formData = await request.formData();
          const clientId = formData.get("id");
          const sha256 = formData.get("sha256");
          const transcriptPart = formData.get("transcript");
          const unifiedTranscriptField = formData.get("unifiedTranscript");

          if (typeof sha256 !== "string" || !transcriptPart || typeof unifiedTranscriptField !== "string") {
            logger.error("Ingest validation failed: missing required form fields", {
              userId,
              receivedKeys: Array.from(formData.keys()),
            });
            return json({ error: "Invalid form data" }, { status: 400 });
          }

          // clientId is optional for backwards compatibility
          const providedId = typeof clientId === "string" && clientId.length > 0 ? clientId : null;

          const transcriptContent =
            typeof transcriptPart === "string" ? transcriptPart : await (transcriptPart as File).text();

          // Validate hash
          const hashValid = await Sentry.startSpan({ name: "validate.hash", op: "validation" }, async () => {
            const computedHash = await sha256Hex(transcriptContent);
            return computedHash === sha256;
          });

          if (!hashValid) {
            logger.warn("Ingest hash mismatch", { userId, expected: sha256 });
            return json({ error: "Transcript hash mismatch" }, { status: 400 });
          }

          // Parse and validate the unified transcript sent by the client
          let parsedTranscript: unknown;
          try {
            parsedTranscript = JSON.parse(unifiedTranscriptField);
          } catch (error) {
            logger.error("Ingest validation failed: could not parse unified transcript", {
              userId,
              error: error instanceof Error ? error.message : String(error),
            });
            return json({ error: "Invalid unified transcript JSON" }, { status: 400 });
          }

          // Validate unified transcript with Zod schema
          const unifiedTranscript = Sentry.startSpan({ name: "validate.schema", op: "validation" }, () => {
            return unifiedTranscriptSchema.parse(parsedTranscript);
          });

          // Extract fields from unifiedTranscript
          const transcriptId = unifiedTranscript.id;
          const repoId = unifiedTranscript.git?.repo ?? null;
          const source: TranscriptSource =
            unifiedTranscript.source === "codex" || unifiedTranscript.source === "claude-code"
              ? unifiedTranscript.source
              : "claude-code";
          const cwd = unifiedTranscript.cwd ?? "";

          // Validate client-provided ID if present
          if (providedId) {
            const existingById = await db.query.transcripts.findFirst({
              where: eq(transcripts.id, providedId),
              columns: { id: true, userId: true, transcriptId: true },
            });

            if (existingById) {
              // Record exists with this ID - validate ownership and transcriptId
              if (existingById.userId !== userId) {
                logger.warn("Ingest rejected: ID belongs to another user", {
                  userId,
                  providedId,
                  existingUserId: existingById.userId,
                });
                return json({ error: "Forbidden: ID belongs to another user" }, { status: 403 });
              }
              if (existingById.transcriptId !== transcriptId) {
                logger.warn("Ingest rejected: ID/transcriptId mismatch", {
                  userId,
                  providedId,
                  existingTranscriptId: existingById.transcriptId,
                  providedTranscriptId: transcriptId,
                });
                return json({ error: "Bad Request: ID does not match transcriptId" }, { status: 400 });
              }
              // Ownership and transcriptId verified - will proceed with upsert
            } else {
              // No record with this ID - check if transcriptId already exists for this user
              const existingByTranscriptId = await db.query.transcripts.findFirst({
                where: and(eq(transcripts.transcriptId, transcriptId), eq(transcripts.userId, userId)),
                columns: { id: true },
              });

              if (existingByTranscriptId) {
                // Client lost local DB - return existing ID for caching
                logger.info("Ingest: returning existing ID (client lost local DB)", {
                  userId,
                  transcriptId,
                  existingId: existingByTranscriptId.id,
                  providedId,
                });
                return json({
                  success: true,
                  id: existingByTranscriptId.id,
                  transcriptId,
                  eventsReceived: 0,
                  sha256,
                  status: "exists",
                });
              }
              // New transcript - will create with client-provided ID
            }
          }

          const rawRecords = parseJsonlRecords(transcriptContent);

          logger.debug("Ingest unified transcript payload", {
            userId,
            repoId,
            transcriptId: unifiedTranscript.id,
            source,
            unifiedTranscript,
          });

          const eventCount = rawRecords.length;
          const repoName = repoId ? deriveRepoName(repoId) : null;

          logger.debug("Ingest raw transcript parsed", {
            userId,
            repoId,
            cwd,
            sample: rawRecords.slice(0, 3),
          });

          logger.info("Ingest unified transcript generated", {
            userId,
            repoId,
            cwd,
            transcriptId: unifiedTranscript.id,
            source,
            preview: unifiedTranscript.preview,
            messageCount: unifiedTranscript.messageCount,
          });

          // Check if transcript already exists with same sha256
          const existingTranscript = await Sentry.startSpan({ name: "db.checkDuplicate", op: "db.query" }, async () => {
            if (repoId) {
              return db.query.repos.findFirst({
                where: eq(repos.repo, repoId),
                with: {
                  transcripts: {
                    where: and(eq(transcripts.transcriptId, transcriptId), eq(transcripts.userId, userId)),
                  },
                },
              });
            } else {
              // For private transcripts (no repo), check by transcriptId and userId only
              const existingPrivateTranscript = await db.query.transcripts.findFirst({
                where: and(eq(transcripts.transcriptId, transcriptId), eq(transcripts.userId, userId)),
              });
              if (existingPrivateTranscript) {
                return { transcripts: [existingPrivateTranscript] };
              }
              return undefined;
            }
          });

          // If transcript exists and SHA-256 matches, return OK
          if (existingTranscript?.transcripts?.[0] && existingTranscript.transcripts[0].sha256 === sha256) {
            logger.info("Ingest skipped: transcript exists with same sha256", {
              userId,
              repoId,
              cwd,
              transcriptId,
              source,
              sha256,
            });
            return json({
              success: true,
              id: existingTranscript.transcripts[0].id,
              transcriptId,
              eventsReceived: eventCount,
              sha256,
              status: "unchanged",
            });
          }

          logger.info("Ingest processing", {
            userId,
            repoId,
            cwd,
            repoName,
            transcriptId,
            eventCount,
            sha256,
          });

          // Create or get repo record (only if repoId is provided)
          let repoDbId: string | null = null;
          if (repoId) {
            const repoRecord = await Sentry.startSpan({ name: "db.upsertRepo", op: "db.query" }, () =>
              db
                .insert(repos)
                .values({
                  repo: repoId,
                  lastActivity: new Date().toISOString(),
                })
                .onConflictDoUpdate({
                  target: repos.repo,
                  set: {
                    lastActivity: new Date().toISOString(),
                  },
                })
                .returning({ id: repos.id }),
            );

            repoDbId = repoRecord[0].id;
          }

          // Compute metadata from unified transcript
          // Use cwd from form data (already formatted by CLI) not from re-converted transcript
          // because backend might be in different environment (e.g., Cloudflare Workers)
          const existingSummary = existingTranscript?.transcripts?.[0]?.summary ?? null;

          // Upload to R2
          const r2Bucket = env.BUCKET;
          // For private transcripts (no repo), use "private/<userId>" as prefix
          const r2KeyPrefix = repoId ? `${repoId}/${transcriptId}` : `private/${userId}/${transcriptId}`;

          // Start summary generation in parallel (if needed)
          const needsSummaryGeneration = !existingSummary && unifiedTranscript.preview;
          const summaryPromise = needsSummaryGeneration
            ? Sentry.startSpan({ name: "ai.generateSummary", op: "ai.run" }, () =>
                generateSummary(unifiedTranscript.preview!)
                  .then((result) => {
                    logger.info("Generated summary", { transcriptId, summary: result.summary });
                    return result.summary;
                  })
                  .catch((error) => {
                    logger.error("Failed to generate summary", {
                      transcriptId,
                      error: error instanceof Error ? error.message : String(error),
                    });
                    return null;
                  }),
              )
            : Promise.resolve(existingSummary);

          // Start R2 uploads in parallel
          const unifiedJson = JSON.stringify(unifiedTranscript);
          const r2UploadsPromise = Sentry.startSpan({ name: "r2.uploadTranscripts", op: "file.write" }, async () => {
            const gzippedRaw = await gzipString(transcriptContent);
            await Promise.all([
              r2Bucket.put(`${r2KeyPrefix}.json`, unifiedJson, {
                httpMetadata: { contentType: "application/json" },
              }),
              r2Bucket.put(`${r2KeyPrefix}.raw.jsonl.gz`, gzippedRaw, {
                httpMetadata: { contentType: "application/x-gzip" },
              }),
            ]);
            logger.debug("Uploaded transcripts to R2", {
              key: r2KeyPrefix,
              unifiedSize: unifiedJson.length,
              rawCompressedSize: gzippedRaw.byteLength,
            });
          });

          // Process blobs (validate SHA256 before parallel uploads)
          const blobEntries = [...formData.entries()]
            .filter(([key, value]) => key.startsWith("blob:") && typeof value !== "string")
            .map(([key, value]) => ({
              sha256: key.slice(5), // Remove "blob:" prefix
              blob: value as unknown as File,
            }));

          // Validate all blob SHA256s first (can't do this in parallel since we need to fail fast)
          const validatedBlobs: Array<{ sha256: string; data: ArrayBuffer; mediaType: string; size: number }> = [];
          for (const { sha256: claimedSha256, blob } of blobEntries) {
            const blobData = await blob.arrayBuffer();
            const actualSha256 = await sha256HexBuffer(blobData);
            if (actualSha256 !== claimedSha256) {
              logger.warn("Blob SHA256 mismatch", {
                userId,
                transcriptId,
                claimed: claimedSha256,
                actual: actualSha256,
              });
              return json(
                { error: `Blob SHA256 mismatch: claimed ${claimedSha256}, actual ${actualSha256}` },
                { status: 400 },
              );
            }
            validatedBlobs.push({
              sha256: actualSha256,
              data: blobData,
              mediaType: blob.type || "application/octet-stream",
              size: blob.size,
            });
          }

          // Upload validated blobs to R2 in parallel
          const blobUploadsPromise =
            validatedBlobs.length > 0
              ? Sentry.startSpan({ name: "r2.uploadBlobs", op: "file.write" }, () =>
                  Promise.all(
                    validatedBlobs.map(async ({ sha256: blobSha256, data, mediaType }) => {
                      const r2Key = `blobs/${blobSha256}`;
                      const existing = await r2Bucket.head(r2Key);
                      if (!existing) {
                        await r2Bucket.put(r2Key, data, { httpMetadata: { contentType: mediaType } });
                        logger.debug("Uploaded blob to R2", { key: r2Key, size: data.byteLength });
                      }
                    }),
                  ),
                )
              : Promise.resolve();

          // Wait for summary and R2 uploads to complete
          const [summary] = await Promise.all([summaryPromise, r2UploadsPromise, blobUploadsPromise]);

          // Determine default visibility for new transcripts
          // (only set on creation, not on update - user may have changed it)
          const defaultVisibility = await getDefaultVisibility(db, repoDbId, repoId, userId);

          const metadata = {
            preview: unifiedTranscript.preview,
            summary,
            model: unifiedTranscript.model,
            costUsd: unifiedTranscript.costUsd,
            blendedTokens: unifiedTranscript.blendedTokens,
            messageCount: unifiedTranscript.messageCount,
            toolCount: unifiedTranscript.toolCount,
            userMessageCount: unifiedTranscript.userMessageCount,
            filesChanged: unifiedTranscript.filesChanged,
            linesAdded: unifiedTranscript.linesAdded,
            linesRemoved: unifiedTranscript.linesRemoved,
            linesModified: unifiedTranscript.linesModified,
            inputTokens: unifiedTranscript.tokenUsage.inputTokens,
            cachedInputTokens: unifiedTranscript.tokenUsage.cachedInputTokens,
            outputTokens: unifiedTranscript.tokenUsage.outputTokens,
            reasoningOutputTokens: unifiedTranscript.tokenUsage.reasoningOutputTokens,
            totalTokens: unifiedTranscript.tokenUsage.totalTokens,
            relativeCwd: unifiedTranscript.git?.relativeCwd ?? null,
            branch: unifiedTranscript.git?.branch ?? null,
            cwd: cwd ?? "",
            createdAt: unifiedTranscript.timestamp,
          };

          // Insert transcript with summary and visibility included
          // Note: visibility is only set on creation, not on update (user may have changed it)
          // Use client-provided ID if available, otherwise let the database generate one
          const insertedTranscript = await Sentry.startSpan({ name: "db.insertTranscript", op: "db.query" }, () =>
            db
              .insert(transcripts)
              .values({
                ...(providedId ? { id: providedId } : {}),
                repoId: repoDbId,
                userId,
                sha256,
                transcriptId,
                source: unifiedTranscript.source,
                visibility: defaultVisibility.visibility,
                sharedWithTeamId: defaultVisibility.sharedWithTeamId,
                ...metadata,
              })
              .onConflictDoUpdate({
                target: [transcripts.userId, transcripts.transcriptId],
                set: {
                  sha256,
                  repoId: repoDbId,
                  // Note: visibility and sharedWithTeamId are NOT updated on conflict
                  // to preserve user's manual changes
                  ...metadata,
                },
              })
              .returning({ id: transcripts.id }),
          );

          const transcriptDbId = insertedTranscript[0].id;

          // Link blobs to transcript (after transcript insert)
          if (validatedBlobs.length > 0) {
            await Sentry.startSpan({ name: "db.linkBlobs", op: "db.query" }, async () => {
              for (const { sha256: blobSha256, mediaType, size } of validatedBlobs) {
                await db.insert(blobs).values({ sha256: blobSha256, mediaType, size }).onConflictDoNothing();
                await db
                  .insert(transcriptBlobs)
                  .values({ transcriptId: transcriptDbId, sha256: blobSha256 })
                  .onConflictDoNothing();
              }
            });
            logger.info("Linked blobs to transcript", { transcriptId, blobCount: validatedBlobs.length });
          }

          // Track successful ingestion
          const status = existingTranscript ? "updated" : "created";
          Sentry.metrics.count("ingest.transcript", 1, {
            attributes: { source, status },
          });

          return json({
            success: true,
            id: transcriptDbId,
            transcriptId,
            eventsReceived: eventCount,
            sha256,
            status,
          });
        });
      },
    },
  },
});

function parseJsonlRecords(content: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];

  content.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    try {
      const value = JSON.parse(line) as unknown;
      if (typeof value === "object" && value !== null) {
        records.push(value as Record<string, unknown>);
        return;
      }
      throw new Error("Parsed value is not an object");
    } catch (error: unknown) {
      logger.warn("Skipping invalid JSONL line", {
        line: index + 1,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return records;
}

function deriveRepoName(repoId: string): string {
  try {
    const url = new URL(repoId);
    const pathname = url.pathname.replace(/\.git$/, "");
    const segments = pathname.split("/").filter(Boolean);
    return segments.slice(-1)[0] ?? repoId;
  } catch {
    return repoId.split("/").filter(Boolean).slice(-1)[0] ?? repoId;
  }
}

async function sha256Hex(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sha256HexBuffer(input: ArrayBuffer): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", input);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function gzipString(input: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);

  // Use CompressionStream API available in Cloudflare Workers
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(data);
      controller.close();
    },
  });

  const compressedStream = stream.pipeThrough(new CompressionStream("gzip"));
  const chunks: Uint8Array[] = [];
  const reader = compressedStream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  // Combine all chunks into a single Uint8Array
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

type DefaultSharingSettings = {
  visibility: VisibilityOption;
  sharedWithTeamId: string | null;
};

/**
 * Get default visibility for a new transcript.
 * Always fetches fresh from GitHub, updates cache, falls back on failure.
 *
 * Logic:
 * 1. If repo is open source → public
 * 2. If has a repo AND user is in a team → team (with specific teamId)
 * 3. Otherwise → private (includes non-repo transcripts)
 */
async function getDefaultVisibility(
  db: DrizzleDB,
  repoDbId: string | null,
  repoFullName: string | null,
  userId: string,
): Promise<DefaultSharingSettings> {
  // 1. Check if repo is public (fresh fetch from GitHub)
  if (repoDbId && repoFullName) {
    const freshIsPublic = await checkRepoIsPublic(repoFullName);

    if (freshIsPublic !== null) {
      // Update cache with fresh value
      await db.update(repos).set({ isPublic: freshIsPublic }).where(eq(repos.id, repoDbId));

      if (freshIsPublic) {
        logger.debug("Repo is public, defaulting to public visibility", { repoFullName });
        return { visibility: "public", sharedWithTeamId: null };
      }
    } else {
      // API failed - check cached value as fallback
      const repo = await db.query.repos.findFirst({ where: eq(repos.id, repoDbId) });
      if (repo?.isPublic) {
        logger.debug("Using cached isPublic=true, defaulting to public visibility", { repoFullName });
        return { visibility: "public", sharedWithTeamId: null };
      }
      // No cache or cache says private - fall through to team check
    }

    // 2. Has a repo (not public) - check if user is in a team
    const membership = await db.query.teamMembers.findFirst({
      where: eq(teamMembers.userId, userId),
    });
    if (membership) {
      logger.debug("User in team, defaulting to team visibility", { repoFullName, teamId: membership.teamId });
      return { visibility: "team", sharedWithTeamId: membership.teamId };
    }
  }

  // 3. Default to private (no repo, or repo but not in team)
  logger.debug("Defaulting to private visibility", { repoFullName });
  return { visibility: "private", sharedWithTeamId: null };
}
