import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";
import { createDrizzle } from "../../../db";
import { transcripts } from "../../../db/schema";
import { getAuthErrorResponse, requireActiveUser } from "../../../lib/access-control";
import { logger } from "../../../lib/logger";

export const Route = createFileRoute("/api/transcripts/clear")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const db = createDrizzle(env.DB);
        logger.debug("Clear transcripts request received");

        let userId: string;
        try {
          const activeUser = await requireActiveUser(request.headers, db);
          userId = activeUser.userId;
        } catch (error) {
          const authError = getAuthErrorResponse(error);
          if (authError) {
            logger.warn("Clear transcripts auth failed", { status: authError.status, error: authError.message });
            return json({ error: authError.message }, { status: authError.status });
          }
          logger.error("Clear transcripts auth failed: unexpected error", {
            error: error instanceof Error ? error.message : String(error),
          });
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        try {
          // Delete all transcripts for this user
          // Note: Repos remain but transcriptCount is now computed dynamically
          const deletedTranscripts = await db.delete(transcripts).where(eq(transcripts.userId, userId)).returning();

          logger.info("Cleared all transcripts", {
            userId,
            transcriptCount: deletedTranscripts.length,
          });

          return json({
            success: true,
            deletedCount: deletedTranscripts.length,
          });
        } catch (error: unknown) {
          logger.error("Failed to clear transcripts", { userId, error });
          return json({ error: "Failed to clear transcripts" }, { status: 500 });
        }
      },
    },
  },
});
