import { createDrizzle } from "@/db";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";
import { repos, transcripts } from "../../db/schema";
import { getAuthErrorResponse, requireActiveUser } from "../../lib/access-control";
import { logger } from "../../lib/logger";

export const Route = createFileRoute("/api/transcripts")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const db = createDrizzle(env.DB);
        logger.debug("Transcripts metadata request received");

        let userId: string;
        try {
          const activeUser = await requireActiveUser(request.headers, db);
          userId = activeUser.userId;
        } catch (error) {
          const authError = getAuthErrorResponse(error);
          if (authError) {
            logger.warn("Transcripts metadata request unauthorized", {
              status: authError.status,
              error: authError.message,
            });
            return json({ error: authError.message }, { status: authError.status });
          }
          logger.error("Transcripts metadata request failed: unexpected error", {
            error: error instanceof Error ? error.message : String(error),
          });
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        try {
          const records = await db
            .select({
              transcriptId: transcripts.transcriptId,
              sha256: transcripts.sha256,
              repoId: repos.repo,
            })
            .from(transcripts)
            .innerJoin(repos, eq(transcripts.repoId, repos.id))
            .where(eq(transcripts.userId, userId));

          logger.info("Transcripts metadata fetched", {
            userId,
            transcriptCount: records.length,
          });

          return json({
            transcripts: records,
          });
        } catch (error) {
          logger.error("Failed to fetch transcripts metadata", {
            userId,
            error,
          });
          return json({ error: "Failed to fetch transcripts metadata" }, { status: 500 });
        }
      },
    },
  },
});
