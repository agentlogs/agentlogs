import { createDrizzle } from "@/db";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { and, eq, isNotNull, or } from "drizzle-orm";
import { blobs, transcriptBlobs, transcripts } from "../../db/schema";
import { createAuth } from "../../lib/auth";
import { logger } from "../../lib/logger";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute("/api/blobs/$sha256" as any)({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { sha256: string } }) => {
        const { sha256 } = params;
        const db = createDrizzle(env.DB);
        const auth = createAuth();

        logger.debug("Blob request received", { sha256: sha256.slice(0, 8) });

        // Get session (optional - public blobs don't need it)
        const session = await auth.api.getSession({
          headers: request.headers,
        });

        // Check access: user owns a transcript with this blob OR blob is in public repo
        const accessQuery = db
          .select({
            mediaType: blobs.mediaType,
            isPublic: transcripts.repoId,
          })
          .from(transcriptBlobs)
          .innerJoin(blobs, eq(transcriptBlobs.sha256, blobs.sha256))
          .innerJoin(transcripts, eq(transcriptBlobs.transcriptId, transcripts.id))
          .where(
            and(
              eq(transcriptBlobs.sha256, sha256),
              or(
                isNotNull(transcripts.repoId), // Public repo transcript
                session?.user ? eq(transcripts.userId, session.user.id) : undefined,
              ),
            ),
          )
          .limit(1);

        const access = await accessQuery;

        if (!access.length) {
          logger.warn("Blob access denied", {
            sha256: sha256.slice(0, 8),
            userId: session?.user?.id,
          });
          return new Response("Not found", { status: 404 });
        }

        const r2Bucket = env.BUCKET;
        const object = await r2Bucket.get(`blobs/${sha256}`);

        if (!object) {
          logger.warn("Blob not found in R2", { sha256: sha256.slice(0, 8) });
          return new Response("Not found", { status: 404 });
        }

        // Cache public blobs aggressively, private blobs not at all
        const isPublic = access[0].isPublic !== null;

        logger.debug("Serving blob", {
          sha256: sha256.slice(0, 8),
          mediaType: access[0].mediaType,
          isPublic,
        });

        return new Response(object.body, {
          headers: {
            "Content-Type": access[0].mediaType,
            "Cache-Control": isPublic
              ? "public, max-age=31536000, immutable" // 1 year (content-addressed)
              : "private, no-store",
            ETag: sha256,
          },
        });
      },
    },
  },
});
