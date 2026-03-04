import { createDrizzle } from "@/db";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";
import * as queries from "../../db/queries";
import { transcripts } from "../../db/schema";
import { getAuthErrorResponse, requireActiveUser } from "../../lib/access-control";
import { logger } from "../../lib/logger";

export const Route = createFileRoute("/api/transcripts/$id")({
  server: {
    handlers: {
      DELETE: async ({ request, params }: { request: Request; params: { id: string } }) => {
        const { id } = params;
        const db = createDrizzle(env.DB);

        logger.debug("Delete transcript request received", { id });

        let userId: string;
        try {
          const activeUser = await requireActiveUser(request.headers, db);
          userId = activeUser.userId;
        } catch (error) {
          const authError = getAuthErrorResponse(error);
          if (authError) {
            logger.warn("Delete transcript auth failed", { status: authError.status, error: authError.message });
            return json({ error: authError.message }, { status: authError.status });
          }
          logger.error("Delete transcript auth failed: unexpected error", {
            error: error instanceof Error ? error.message : String(error),
          });
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        // Get user role to check if admin
        const userRole = await queries.getUserRole(db, userId);
        const isAdmin = userRole === "admin";

        // Get transcript from database
        const transcript = await db.query.transcripts.findFirst({
          where: eq(transcripts.id, id),
          with: {
            repo: {
              columns: { repo: true },
            },
          },
        });

        if (!transcript) {
          logger.warn("Delete transcript: not found", { id, userId });
          return json({ error: "Transcript not found" }, { status: 404 });
        }

        // Check if user is owner or admin
        if (transcript.userId !== userId && !isAdmin) {
          logger.warn("Delete transcript: forbidden", { id, userId, ownerId: transcript.userId });
          return json({ error: "Forbidden: You can only delete your own transcripts" }, { status: 403 });
        }

        try {
          // Construct R2 key based on whether it's a repo or private transcript
          const repoName = transcript.repo?.repo;
          const r2Key = repoName
            ? `${repoName}/${transcript.transcriptId}.json`
            : `private/${transcript.userId}/${transcript.transcriptId}.json`;

          // Delete from R2 first
          await env.BUCKET.delete(r2Key);
          logger.info("Deleted unified transcript from R2", { r2Key });

          // Delete transcript record from database
          // Note: Associated transcript_blobs will be cascade deleted
          // but we do NOT delete the blobs themselves (they may be shared)
          await db.delete(transcripts).where(eq(transcripts.id, id));

          logger.info("Transcript deleted successfully", {
            transcriptId: id,
            transcriptUuid: transcript.transcriptId,
            deletedBy: userId,
            isAdmin,
          });

          return json({ success: true });
        } catch (error) {
          logger.error("Failed to delete transcript", {
            id,
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
          return json({ error: "Failed to delete transcript" }, { status: 500 });
        }
      },
    },
  },
});
