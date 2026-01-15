import { ORPCError, os } from "@orpc/server";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { createDrizzle } from "../../db";
import { commitTracking, repos, transcripts } from "../../db/schema";
import { createAuth } from "../auth";
import { logger } from "../logger";

interface Context {
  request: Request;
}

interface AuthedContext extends Context {
  userId: string;
}

const base = os.$context<Context>();

const authedProcedure = base.use(async ({ context, next }) => {
  const auth = createAuth();

  const session = await auth.api.getSession({
    headers: context.request.headers,
  });

  if (!session?.user) {
    throw new ORPCError("UNAUTHORIZED");
  }

  return next({
    context: {
      ...context,
      userId: session.user.id,
    } satisfies AuthedContext,
  });
});

export const router = base.router({
  transcripts: base.router({
    list: authedProcedure.handler(async ({ context }) => {
      const db = createDrizzle(env.DB);
      const { userId } = context;

      logger.debug("oRPC: transcripts.list called", { userId });

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

        logger.info("oRPC: transcripts.list success", {
          userId,
          transcriptCount: records.length,
        });

        return { transcripts: records };
      } catch (error) {
        logger.error("oRPC: transcripts.list failed", { userId, error });
        throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to fetch transcripts metadata" });
      }
    }),
  }),

  commitTrack: base.router({
    create: authedProcedure
      .input(
        z.object({
          sessionId: z.string().min(1),
          repoPath: z.string().min(1),
          timestamp: z.string().min(1),
        }),
      )
      .handler(async ({ context, input }) => {
        const db = createDrizzle(env.DB);
        const { userId } = context;
        const { sessionId, repoPath, timestamp } = input;

        logger.debug("oRPC: commitTrack.create called", {
          userId,
          sessionId: sessionId.substring(0, 8),
          repoPath,
        });

        try {
          await db.insert(commitTracking).values({
            userId,
            sessionId,
            repoPath,
            timestamp,
          });

          logger.info("oRPC: commitTrack.create success", {
            userId,
            sessionId: sessionId.substring(0, 8),
            repoPath,
          });

          return { success: true };
        } catch (error) {
          logger.error("oRPC: commitTrack.create failed", {
            userId,
            sessionId: sessionId.substring(0, 8),
            repoPath,
            error: error instanceof Error ? error.message : String(error),
          });
          throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to track commit" });
        }
      }),
  }),
});

export type Router = typeof router;
