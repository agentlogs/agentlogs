import { createDrizzle } from "@/db";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import type { TranscriptSource } from "@vibeinsights/shared";
import { unifiedTranscriptSchema } from "@vibeinsights/shared/schemas";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { blobs, repos, transcriptBlobs, transcripts } from "../../db/schema";
import { createAuth } from "../../lib/auth";
import { logger } from "../../lib/logger";

export const Route = createFileRoute("/api/ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const db = createDrizzle(env.DB);
        const auth = createAuth();

        logger.debug("Ingest request received");

        const session = await auth.api.getSession({
          headers: request.headers,
        });

        if (!session?.user) {
          logger.warn("Ingest auth failed: no session");
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        let userId = session.user.id;

        // Parse multipart form data (raw transcript upload)
        const formData = await request.formData();
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

        const transcriptContent =
          typeof transcriptPart === "string" ? transcriptPart : await (transcriptPart as File).text();

        const computedHash = await sha256Hex(transcriptContent);
        if (computedHash !== sha256) {
          logger.warn("Ingest hash mismatch", {
            userId,
            expected: sha256,
            actual: computedHash,
          });
          return json({ error: "Transcript hash mismatch" }, { status: 400 });
        }

        // Parse and validate the unified transcript sent by the client
        let unifiedTranscript;
        try {
          unifiedTranscript = JSON.parse(unifiedTranscriptField);
        } catch (error) {
          logger.error("Ingest validation failed: could not parse unified transcript", {
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
          return json({ error: "Invalid unified transcript JSON" }, { status: 400 });
        }

        // Validate unified transcript with Zod schema
        try {
          unifiedTranscript = unifiedTranscriptSchema.parse(unifiedTranscript);
        } catch (error) {
          logger.error("Ingest validation failed: unified transcript schema validation failed", {
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
          return json({ error: "Unified transcript schema validation failed" }, { status: 400 });
        }

        // Extract fields from unifiedTranscript
        const transcriptId = unifiedTranscript.id;
        const repoId = unifiedTranscript.git?.repo ?? null;
        const source: TranscriptSource =
          unifiedTranscript.source === "codex" || unifiedTranscript.source === "claude-code"
            ? unifiedTranscript.source
            : "claude-code";
        const cwd = unifiedTranscript.cwd ?? "";

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
        let existingTranscript;
        if (repoId) {
          existingTranscript = await db.query.repos.findFirst({
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
            existingTranscript = {
              transcripts: [existingPrivateTranscript],
            };
          }
        }

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
          const repoRecord = await db
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
            .returning({ id: repos.id });

          repoDbId = repoRecord[0].id;
        }

        // Compute metadata from unified transcript
        // Use cwd from form data (already formatted by CLI) not from re-converted transcript
        // because backend might be in different environment (e.g., Cloudflare Workers)
        const metadata = {
          preview: unifiedTranscript.preview,
          model: unifiedTranscript.model,
          costUsd: unifiedTranscript.costUsd,
          blendedTokens: unifiedTranscript.blendedTokens,
          messageCount: unifiedTranscript.messageCount,
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

        // Insert or update transcript
        const insertedTranscript = await db
          .insert(transcripts)
          .values({
            repoId: repoDbId,
            userId,
            sha256,
            transcriptId,
            source: unifiedTranscript.source,
            ...metadata,
          })
          .onConflictDoUpdate({
            target: [transcripts.userId, transcripts.transcriptId],
            set: {
              sha256,
              repoId: repoDbId,
              ...metadata,
            },
          })
          .returning({ id: transcripts.id });

        const transcriptDbId = insertedTranscript[0].id;

        // Upload to R2
        const r2Bucket = env.BUCKET;
        // For private transcripts (no repo), use "private/<userId>" as prefix
        const r2KeyPrefix = repoId ? `${repoId}/${transcriptId}` : `private/${userId}/${transcriptId}`;

        // Extract and process blobs from form data
        const blobEntries = [...formData.entries()]
          .filter(([key, value]) => key.startsWith("blob:") && typeof value !== "string")
          .map(([key, value]) => ({
            sha256: key.slice(5), // Remove "blob:" prefix
            blob: value as unknown as File,
          }));

        if (blobEntries.length > 0) {
          logger.debug("Processing blobs", {
            userId,
            transcriptId,
            blobCount: blobEntries.length,
          });

          for (const { sha256: blobSha256, blob } of blobEntries) {
            // Upload blob to R2 if it doesn't exist (content-addressed deduplication)
            const r2Key = `blobs/${blobSha256}`;
            const existingBlob = await r2Bucket.head(r2Key);

            if (!existingBlob) {
              const blobData = await blob.arrayBuffer();
              await r2Bucket.put(r2Key, blobData, {
                httpMetadata: {
                  contentType: blob.type || "application/octet-stream",
                },
              });
              logger.debug("Uploaded blob to R2", {
                key: r2Key,
                size: blobData.byteLength,
                mediaType: blob.type,
              });
            } else {
              logger.debug("Blob already exists in R2, skipping upload", {
                key: r2Key,
              });
            }

            // Record blob metadata in database (upsert)
            await db
              .insert(blobs)
              .values({
                sha256: blobSha256,
                mediaType: blob.type || "application/octet-stream",
                size: blob.size,
              })
              .onConflictDoNothing();

            // Link blob to transcript
            await db
              .insert(transcriptBlobs)
              .values({
                transcriptId: transcriptDbId,
                sha256: blobSha256,
              })
              .onConflictDoNothing();
          }

          logger.info("Processed blobs for transcript", {
            userId,
            transcriptId,
            blobCount: blobEntries.length,
          });
        }

        // Upload unified transcript as JSON
        const unifiedJson = JSON.stringify(unifiedTranscript);
        await r2Bucket.put(`${r2KeyPrefix}.json`, unifiedJson, {
          httpMetadata: {
            contentType: "application/json",
          },
        });
        logger.debug("Uploaded unified transcript to R2", {
          key: `${r2KeyPrefix}.json`,
          size: unifiedJson.length,
        });

        // Upload gzipped raw transcript
        const gzippedRaw = await gzipString(transcriptContent);
        await r2Bucket.put(`${r2KeyPrefix}.raw.jsonl.gz`, gzippedRaw, {
          httpMetadata: {
            contentType: "application/x-gzip",
          },
        });
        logger.debug("Uploaded raw transcript to R2", {
          key: `${r2KeyPrefix}.raw.jsonl.gz`,
          originalSize: transcriptContent.length,
          compressedSize: gzippedRaw.byteLength,
        });

        return json({
          success: true,
          transcriptId,
          eventsReceived: eventCount,
          sha256,
          status: existingTranscript ? "updated" : "created",
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
