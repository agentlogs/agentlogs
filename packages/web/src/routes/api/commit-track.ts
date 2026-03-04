import { createDrizzle } from "@/db";
import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";
import { env } from "@/lib/env";
import { eq } from "drizzle-orm";
import { commitTracking, transcripts } from "../../db/schema";
import { requireActiveUser, getAuthErrorResponse } from "../../lib/access-control";
import { logger } from "../../lib/logger";

interface CommitTrackPayload {
  transcript_id?: string;
  repo_path?: string;
  timestamp?: string;
  commit_sha?: string;
  commit_title?: string;
  branch?: string;
}

export const Route = createFileRoute("/api/commit-track")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const db = createDrizzle(env.DB);
        logger.debug("Commit track request received");

        let userId: string;
        let userRole: "user" | "admin";
        try {
          const activeUser = await requireActiveUser(request.headers, db);
          userId = activeUser.userId;
          userRole = activeUser.role;
        } catch (error) {
          const authError = getAuthErrorResponse(error);
          if (authError) {
            logger.warn("Commit track auth failed", { status: authError.status, error: authError.message });
            return json({ error: authError.message }, { status: authError.status });
          }
          logger.error("Commit track auth failed: unexpected error", {
            error: error instanceof Error ? error.message : String(error),
          });
          return json({ error: "Unauthorized" }, { status: 401 });
        }

        let payload: CommitTrackPayload;
        try {
          payload = (await request.json()) as CommitTrackPayload;
        } catch (error) {
          logger.error("Commit track validation failed: invalid JSON", {
            userId,
            error: error instanceof Error ? error.message : String(error),
          });
          return json({ error: "Invalid JSON" }, { status: 400 });
        }

        const { transcript_id, repo_path, timestamp, commit_sha, commit_title, branch } = payload;

        if (!transcript_id || !repo_path || !timestamp) {
          logger.error("Commit track validation failed: missing required fields", {
            userId,
            transcript_id,
            repo_path,
            timestamp,
          });
          return json({ error: "Missing required fields" }, { status: 400 });
        }

        try {
          const transcript = await db.query.transcripts.findFirst({
            columns: { userId: true },
            where: eq(transcripts.id, transcript_id),
          });

          if (!transcript) {
            logger.warn("Commit track rejected: transcript not found", { transcriptId: transcript_id, userId });
            return json({ error: "Transcript not found" }, { status: 404 });
          }

          if (transcript.userId !== userId && userRole !== "admin") {
            logger.warn("Commit track rejected: not owner", {
              transcriptId: transcript_id,
              userId,
              ownerId: transcript.userId,
            });
            return json({ error: "Forbidden: You can only track commits for your own transcripts" }, { status: 403 });
          }

          await db.insert(commitTracking).values({
            userId,
            transcriptId: transcript_id,
            repoPath: repo_path,
            timestamp,
            commitSha: commit_sha,
            commitTitle: commit_title,
            branch,
          });

          logger.info("Commit track stored", {
            userId,
            transcriptId: transcript_id.substring(0, 8),
            repoPath: repo_path,
            commitSha: commit_sha?.substring(0, 8),
          });

          return json({ success: true });
        } catch (error) {
          logger.error("Commit track insert failed", {
            userId,
            transcriptId: transcript_id.substring(0, 8),
            repoPath: repo_path,
            error: error instanceof Error ? error.message : String(error),
          });
          return json({ error: "Failed to track commit" }, { status: 500 });
        }
      },
    },
  },
});
