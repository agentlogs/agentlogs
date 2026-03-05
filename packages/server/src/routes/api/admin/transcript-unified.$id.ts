import { createDrizzle } from "@/db";
import { createFileRoute } from "@tanstack/react-router";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";
import * as queries from "../../../db/queries";
import { transcripts } from "../../../db/schema";
import { createAuth } from "../../../lib/auth";
import { logger } from "../../../lib/logger";

async function requireAdmin(request: Request): Promise<string | Response> {
  const auth = createAuth();
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session?.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = createDrizzle(env.DB);
  const role = await queries.getUserRole(db, session.user.id);

  if (role !== "admin") {
    return new Response(JSON.stringify({ error: "Forbidden: Admin access required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  return session.user.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute("/api/admin/transcript-unified/$id" as any)({
  server: {
    handlers: {
      GET: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const { id } = params;

        // Verify admin status
        const adminResult = await requireAdmin(request);
        if (adminResult instanceof Response) {
          return adminResult;
        }

        const db = createDrizzle(env.DB);

        // Get transcript from database to find R2 path
        const transcript = await db.query.transcripts.findFirst({
          where: eq(transcripts.id, id),
          with: {
            repo: {
              columns: { repo: true },
            },
          },
        });

        if (!transcript) {
          logger.warn("Admin transcript download: not found", { id });
          return new Response(JSON.stringify({ error: "Transcript not found" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Construct R2 key based on whether it's a repo or private transcript
        const repoName = transcript.repo?.repo;
        const r2Key = repoName
          ? `${repoName}/${transcript.transcriptId}.json`
          : `private/${transcript.userId}/${transcript.transcriptId}.json`;

        const r2Object = await env.BUCKET.get(r2Key);
        if (!r2Object) {
          logger.error("Admin transcript download: R2 object not found", { id, r2Key });
          return new Response(JSON.stringify({ error: "Transcript content not found in storage" }), {
            status: 404,
            headers: { "Content-Type": "application/json" },
          });
        }

        logger.info("Admin downloaded unified transcript", {
          adminId: adminResult,
          transcriptId: id,
          transcriptUuid: transcript.transcriptId,
        });

        const content = await r2Object.text();

        return new Response(content, {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
