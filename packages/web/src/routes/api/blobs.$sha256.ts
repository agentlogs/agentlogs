import { createDrizzle } from "@/db";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { and, eq } from "drizzle-orm";
import { blobs, transcriptBlobs, transcripts } from "../../db/schema";
import { createAuth } from "../../lib/auth";
import { logger } from "../../lib/logger";

type BlobAccessResult =
  | { authorized: true; mediaType: string }
  | { authorized: false; response: Response };

async function checkBlobAccess(request: Request, sha256: string): Promise<BlobAccessResult> {
  const db = createDrizzle(env.DB);
  const auth = createAuth();

  const session = await auth.api.getSession({
    headers: request.headers,
  });

  if (!session?.user) {
    logger.warn("Blob access denied: no authenticated user", {
      sha256: sha256.slice(0, 8),
    });
    return { authorized: false, response: new Response(null, { status: 401 }) };
  }

  const access = await db
    .select({ mediaType: blobs.mediaType })
    .from(transcriptBlobs)
    .innerJoin(blobs, eq(transcriptBlobs.sha256, blobs.sha256))
    .innerJoin(transcripts, eq(transcriptBlobs.transcriptId, transcripts.id))
    .where(and(eq(transcriptBlobs.sha256, sha256), eq(transcripts.userId, session.user.id)))
    .limit(1);

  if (!access.length) {
    logger.warn("Blob access denied", {
      sha256: sha256.slice(0, 8),
      userId: session.user.id,
    });
    return { authorized: false, response: new Response(null, { status: 404 }) };
  }

  return { authorized: true, mediaType: access[0].mediaType };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute("/api/blobs/$sha256" as any)({
  server: {
    handlers: {
      HEAD: async ({ request, params }: { request: Request; params: { sha256: string } }) => {
        const { sha256 } = params;
        logger.debug("Blob HEAD request received", { sha256: sha256.slice(0, 8) });

        const accessResult = await checkBlobAccess(request, sha256);
        if (!accessResult.authorized) {
          return accessResult.response;
        }

        const object = await env.BUCKET.head(`blobs/${sha256}`);
        if (!object) {
          return new Response(null, { status: 404 });
        }

        return new Response(null, {
          status: 200,
          headers: {
            ETag: sha256,
            "Content-Length": String(object.size),
          },
        });
      },
      GET: async ({ request, params }: { request: Request; params: { sha256: string } }) => {
        const { sha256 } = params;
        logger.debug("Blob GET request received", { sha256: sha256.slice(0, 8) });

        const accessResult = await checkBlobAccess(request, sha256);
        if (!accessResult.authorized) {
          return accessResult.response;
        }

        const object = await env.BUCKET.get(`blobs/${sha256}`);
        if (!object) {
          logger.warn("Blob not found in R2", { sha256: sha256.slice(0, 8) });
          return new Response("Not found", { status: 404 });
        }

        logger.debug("Serving blob", {
          sha256: sha256.slice(0, 8),
          mediaType: accessResult.mediaType,
        });

        return new Response(object.body, {
          headers: {
            "Content-Type": accessResult.mediaType,
            "Cache-Control": "private, max-age=31536000, immutable",
            ETag: sha256,
          },
        });
      },
    },
  },
});
