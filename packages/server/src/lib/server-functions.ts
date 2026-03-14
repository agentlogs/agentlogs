import { init } from "@paralleldrive/cuid2";
import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "@/lib/env";
import { and, eq, sql } from "drizzle-orm";
import { createDrizzle } from "../db";
import * as queries from "../db/queries";
import {
  commitTracking,
  teamInvites,
  teamMembers,
  teams,
  transcripts,
  user,
  userRoles,
  visibilityOptions,
  type UserRole,
  type VisibilityOption,
} from "../db/schema";
import { createAuth } from "./auth";
import { requireActiveUser, tryGetActiveUserId } from "./access-control";
import { logger } from "./logger";

let cuidGenerator: (() => string) | undefined;
const getCuidGenerator = () => {
  if (!cuidGenerator) {
    cuidGenerator = init();
  }
  return cuidGenerator;
};
const generateId = () => getCuidGenerator()();

/**
 * Get the current authenticated user's ID
 * Throws if not authenticated
 */
async function getAuthenticatedUserId() {
  const { userId } = await requireActiveUser(getRequestHeaders());
  return userId;
}

/**
 * Server function to fetch the current session
 * Returns null if not authenticated
 */
export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  try {
    const auth = createAuth();
    const session = await auth.api.getSession({
      headers: getRequestHeaders(),
    });

    if (!session?.user) {
      return null;
    }

    // Fetch user role from database
    const db = createDrizzle(env.DB);
    let role: string | null = null;
    try {
      role = await queries.getUserRole(db, session.user.id);
    } catch (roleError) {
      logger.error("Failed to fetch user role, defaulting to waitlist", {
        userId: session.user.id,
        error: roleError instanceof Error ? roleError.message : String(roleError),
      });
      // Default to waitlist if role fetch fails - don't break the session
    }

    return {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
        role: role ?? "waitlist",
      },
      session: {
        id: session.session.id,
        expiresAt: session.session.expiresAt,
      },
    };
  } catch (error) {
    logger.error("getSession failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    // Return null instead of throwing - SSR must not fail for unauthenticated users
    return null;
  }
});

/**
 * Server function to fetch all repositories for the authenticated user
 */
export const getRepos = createServerFn().handler(async () => {
  const db = createDrizzle(env.DB);
  const userId = await getAuthenticatedUserId();
  return queries.getRepos(db, userId);
});

/**
 * Server function to fetch private transcripts grouped by cwd
 */
export const getPrivateTranscriptsByCwd = createServerFn().handler(async () => {
  const db = createDrizzle(env.DB);
  const userId = await getAuthenticatedUserId();
  return queries.getPrivateTranscriptsByCwd(db, userId);
});

/**
 * Server function to fetch transcripts for a specific repository
 */
export const getTranscriptsByRepo = createServerFn()
  .inputValidator((repoId: string) => repoId)
  .handler(async ({ data: repoId }) => {
    const db = createDrizzle(env.DB);
    const userId = await getAuthenticatedUserId();
    const transcripts = await queries.getTranscriptsByRepo(db, userId, repoId);

    // Transform to simplified view
    return transcripts.map((t) => ({
      id: t.id,
      repoId: t.repoId,
      transcriptId: t.transcriptId,
      source: t.source,
      preview: t.preview,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      messageCount: t.messageCount,
      costUsd: t.costUsd,
      userName: t.userName,
      userImage: t.userImage,
    }));
  });

/**
 * Server function to fetch transcripts for a specific cwd (private transcripts)
 */
export const getTranscriptsByCwd = createServerFn()
  .inputValidator((cwd: string) => cwd)
  .handler(async ({ data: cwd }) => {
    const db = createDrizzle(env.DB);
    const userId = await getAuthenticatedUserId();
    const transcripts = await queries.getTranscriptsByCwd(db, userId, cwd);

    // Transform to simplified view
    return transcripts.map((t) => ({
      id: t.id,
      repoId: t.repoId,
      transcriptId: t.transcriptId,
      source: t.source,
      preview: t.preview,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      messageCount: t.messageCount,
      costUsd: t.costUsd,
      cwd: t.cwd,
      userName: t.userName,
      userImage: t.userImage,
    }));
  });

/**
 * Try to get the current user's ID without throwing
 * Returns null if not authenticated
 */
async function tryGetUserId(): Promise<string | null> {
  return tryGetActiveUserId(getRequestHeaders());
}

/**
 * Server function to fetch a single transcript (with access control)
 * Returns transcript if viewer owns it, it's public, or shared with viewer's team
 * For unauthenticated users, only returns public transcripts
 */
export const getTranscript = createServerFn({ method: "GET" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const db = createDrizzle(env.DB);
    const viewerId = await tryGetUserId();

    let transcript;
    let isAdmin = false;

    if (viewerId) {
      // Authenticated user - use full access control
      const viewerRole = await queries.getUserRole(db, viewerId);
      isAdmin = viewerRole === "admin";
      transcript = await queries.getTranscriptWithAccess(db, viewerId, id);
    } else {
      // Unauthenticated user - only allow public transcripts
      transcript = await queries.getPublicTranscript(db, id);
    }

    if (!transcript) {
      throw new Error("Transcript not found");
    }

    // Determine R2 key based on whether this is a repo or private transcript
    // Note: Use transcript owner's userId for R2 path, not viewer's
    const r2Key = transcript.repoName
      ? `${transcript.repoName}/${transcript.transcriptId}.json`
      : `private/${transcript.userId}/${transcript.transcriptId}.json`;

    // Fetch R2 content AND commits in parallel for better performance
    const [r2Object, commits] = await Promise.all([
      env.BUCKET.get(r2Key),
      db
        .select({
          commitSha: commitTracking.commitSha,
          commitTitle: commitTracking.commitTitle,
          branch: commitTracking.branch,
          timestamp: commitTracking.timestamp,
        })
        .from(commitTracking)
        .where(eq(commitTracking.transcriptId, transcript.id))
        .orderBy(commitTracking.timestamp),
    ]);

    if (!r2Object) {
      logger.error("Unified transcript not found in R2", { key: r2Key });
      throw new Error("Transcript content not found");
    }

    const unifiedTranscript = JSON.parse(await r2Object.text());

    // Return transcript with metadata and unified content
    return {
      id: transcript.id,
      repoId: transcript.repoId,
      // Only expose debug info to admins
      transcriptId: isAdmin ? transcript.transcriptId : undefined,
      costUsd: isAdmin ? transcript.costUsd : undefined,
      inputTokens: isAdmin ? transcript.inputTokens : undefined,
      outputTokens: isAdmin ? transcript.outputTokens : undefined,
      cachedInputTokens: isAdmin ? transcript.cachedInputTokens : undefined,
      source: transcript.source,
      preview: transcript.preview,
      summary: transcript.summary,
      createdAt: transcript.createdAt,
      updatedAt: transcript.updatedAt,
      visibility: transcript.visibility,
      unifiedTranscript,
      userName: transcript.userName,
      userUsername: transcript.userUsername,
      userImage: transcript.userImage,
      isOwner: viewerId ? transcript.userId === viewerId : false,
      isAdmin,
      linesAdded: transcript.linesAdded,
      linesRemoved: transcript.linesRemoved,
      linesModified: transcript.linesModified,
      commits: commits
        .filter((c) => c.commitSha)
        .map((c) => ({
          sha: c.commitSha as string,
          title: c.commitTitle,
          branch: c.branch,
          timestamp: c.timestamp,
        })),
      // Base URL for OG meta tags (absolute URLs required for social sharing)
      baseUrl: env.WEB_URL,
    };
  });

/**
 * Server function to fetch a transcript by ID and redirect to the detail page.
 * For unauthenticated users, only returns public transcripts.
 */
export const getTranscriptBySessionId = createServerFn({ method: "GET" })
  .inputValidator((id: string) => id)
  .handler(async ({ data: id }) => {
    const db = createDrizzle(env.DB);
    const userId = await tryGetUserId();

    let transcript;
    if (userId) {
      transcript = await queries.getTranscriptWithAccess(db, userId, id);
    } else {
      transcript = await queries.getPublicTranscript(db, id);
    }

    if (!transcript) {
      throw new Error("Transcript not found");
    }

    return { id: transcript.id };
  });

/**
 * Server function to fetch all visible transcripts for the authenticated user
 * Includes: own transcripts, public transcripts, team-shared transcripts
 */
export const getAllTranscripts = createServerFn().handler(async () => {
  const db = createDrizzle(env.DB);
  const viewerId = await getAuthenticatedUserId();

  // Use access-controlled query
  const allTranscripts = await queries.getVisibleTranscripts(db, viewerId);

  return allTranscripts.map((t) => ({
    id: t.id,
    repoId: t.repoId,
    transcriptId: t.transcriptId,
    source: t.source,
    preview: t.preview,
    summary: t.summary,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    messageCount: t.messageCount,
    toolCount: t.toolCount,
    userMessageCount: t.userMessageCount,
    filesChanged: t.filesChanged,
    linesAdded: t.linesAdded,
    linesRemoved: t.linesRemoved,
    linesModified: t.linesModified,
    costUsd: t.costUsd,
    userName: t.userName,
    userImage: t.userImage,
    repoName: t.repoName,
    branch: t.branch,
    cwd: t.cwd,
    visibility: t.visibility,
    isOwner: t.userId === viewerId,
  }));
});

const PAGE_SIZE = 20;

/**
 * Server function to fetch daily activity counts for the activity chart
 */
export const getDailyActivity = createServerFn({ method: "GET" }).handler(async () => {
  const db = createDrizzle(env.DB);
  const userId = await getAuthenticatedUserId();
  const results = await queries.getDailyActivityCounts(db, userId, 30);

  // Fill in missing days with 0 counts
  const counts = new Map(results.map((r) => [r.date, r.count]));
  const filledData: Array<{ date: string; count: number }> = [];
  const today = new Date();

  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().split("T")[0];
    filledData.push({ date: key, count: counts.get(key) ?? 0 });
  }

  return filledData;
});

/**
 * Server function to fetch transcripts with cursor-based pagination
 */
export const getTranscriptsPaginated = createServerFn({ method: "GET" })
  .inputValidator(
    (data: {
      cursor?: { createdAt: string; id: string } | null;
      limit?: number;
      search?: string;
      repoId?: string | null; // null = private only, undefined = all
    }) => {
      const cursor = data.cursor ? { createdAt: new Date(data.cursor.createdAt), id: data.cursor.id } : undefined;
      const limit = Math.min(Math.max(data.limit ?? PAGE_SIZE, 1), 100);
      const search = data.search?.trim() || undefined;
      const repoId = data.repoId;
      return { cursor, limit, search, repoId };
    },
  )
  .handler(async ({ data }) => {
    const db = createDrizzle(env.DB);
    const userId = await getAuthenticatedUserId();
    const result = await queries.getTranscriptsPaginated(db, userId, data);

    return {
      items: result.items.map((t) => ({
        id: t.id,
        repoId: t.repoId,
        transcriptId: t.transcriptId,
        source: t.source,
        preview: t.preview,
        summary: t.summary,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        messageCount: t.messageCount,
        toolCount: t.toolCount,
        userMessageCount: t.userMessageCount,
        filesChanged: t.filesChanged,
        linesAdded: t.linesAdded,
        linesRemoved: t.linesRemoved,
        linesModified: t.linesModified,
        costUsd: t.costUsd,
        userName: t.userName,
        userImage: t.userImage,
        repoName: t.repoName,
        branch: t.branch,
        cwd: t.cwd,
        visibility: t.visibility,
        previewBlobSha256: (t as typeof t & { previewBlobSha256?: string | null }).previewBlobSha256 ?? null,
      })),
      nextCursor: result.nextCursor
        ? { createdAt: result.nextCursor.createdAt.toISOString(), id: result.nextCursor.id }
        : null,
      hasMore: result.hasMore,
    };
  });

// =============================================================================
// Admin Server Functions
// =============================================================================

/**
 * Check if current user is an admin
 */
async function requireAdmin() {
  const auth = createAuth();
  const headers = getRequestHeaders();

  const session = await auth.api.getSession({ headers });
  if (!session?.user) {
    throw new Error("Unauthorized");
  }

  const db = createDrizzle(env.DB);
  const role = await queries.getUserRole(db, session.user.id);

  if (role !== "admin") {
    throw new Error("Forbidden: Admin access required");
  }

  return session.user.id;
}

/**
 * Get admin dashboard stats
 */
export const getAdminStats = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const db = createDrizzle(env.DB);
  return queries.getAdminAggregateStats(db);
});

/**
 * Get all users with their stats (admin only)
 */
export const getAdminUsers = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const db = createDrizzle(env.DB);
  return queries.getAdminUserStats(db);
});

/**
 * Update a user's role (admin only)
 */
export const updateUserRole = createServerFn({ method: "POST" })
  .inputValidator((data: { userId: string; role: string }) => {
    if (!data.userId || typeof data.userId !== "string") {
      throw new Error("Invalid userId");
    }
    if (!userRoles.includes(data.role as UserRole)) {
      throw new Error(`Invalid role: ${data.role}`);
    }
    return data as { userId: string; role: UserRole };
  })
  .handler(async ({ data }) => {
    await requireAdmin();
    const db = createDrizzle(env.DB);
    await queries.updateUserRole(db, data.userId, data.role);
    return { success: true };
  });

/**
 * Send welcome email to a user (admin only)
 */
export const sendWelcomeEmail = createServerFn({ method: "POST" })
  .inputValidator((data: { userId: string }) => {
    if (!data.userId || typeof data.userId !== "string") {
      throw new Error("Invalid userId");
    }
    return data;
  })
  .handler(async ({ data }) => {
    await requireAdmin();
    const db = createDrizzle(env.DB);

    // Get user info
    const targetUser = await queries.getUserById(db, data.userId);
    if (!targetUser) {
      throw new Error("User not found");
    }

    // Send email
    const { sendWelcomePreviewEmail } = await import("./email/send");
    const result = await sendWelcomePreviewEmail(targetUser.email, targetUser.name);

    if (!result.success) {
      throw new Error(result.error ?? "Failed to send email");
    }

    // Mark as sent
    await queries.markWelcomeEmailSent(db, data.userId);

    return { success: true };
  });

// =============================================================================
// Team Server Functions
// =============================================================================

/**
 * Get user's team with members
 */
export const getTeam = createServerFn({ method: "GET" }).handler(async () => {
  const db = createDrizzle(env.DB);
  const userId = await getAuthenticatedUserId();
  return queries.getUserTeam(db, userId);
});

/**
 * Create a new team with a user-provided name
 */
export const createTeam = createServerFn({ method: "POST" })
  .inputValidator((input: { name: string }) => input)
  .handler(async ({ data: { name } }) => {
    const db = createDrizzle(env.DB);
    const { userId } = await requireActiveUser(getRequestHeaders(), db);

    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new Error("Team name is required");
    }

    const teamName = trimmedName;

    // Check if user is already in a team (app-level enforcement)
    const existingMembership = await db.query.teamMembers.findFirst({
      where: eq(teamMembers.userId, userId),
    });
    if (existingMembership) {
      throw new Error("Already in a team. Leave current team first.");
    }

    // Batch: create team + add owner as member atomically
    // Pre-generate ID since batch can't reference results between statements
    const teamId = generateId();

    await db.transaction(async (tx) => {
      await tx.insert(teams).values({
        id: teamId,
        name: teamName,
        ownerId: userId,
      });
      await tx.insert(teamMembers).values({
        teamId: teamId,
        userId: userId,
      });
    });

    logger.info("Team created", { teamId, ownerId: userId });
    return { id: teamId, name: teamName };
  });

/**
 * Delete team (owner only)
 * Note: No visibility reset needed - ON DELETE SET NULL handles sharedWithTeamId,
 * and access control checks owner-in-team which will fail.
 */
export const deleteTeam = createServerFn({ method: "POST" })
  .inputValidator((teamId: string) => teamId)
  .handler(async ({ data: teamId }) => {
    const db = createDrizzle(env.DB);
    const userId = await getAuthenticatedUserId();

    // Verify team exists and user is owner
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId),
    });
    if (!team) {
      throw new Error("Team not found");
    }
    if (team.ownerId !== userId) {
      throw new Error("Only the owner can delete the team");
    }

    // Enable foreign keys for local D1 (remote D1 has them enabled by default)
    // This ensures CASCADE deletes work correctly
    await db.run(sql`PRAGMA foreign_keys = ON`);
    await db.delete(teams).where(eq(teams.id, teamId));

    logger.info("Team deleted", { teamId, deletedBy: userId });
    return { success: true };
  });

/**
 * Leave team (non-owner only)
 * Note: No visibility reset needed - access control checks owner-in-team which will fail
 * after leaving. Transcripts with sharedWithTeamId still set become inaccessible.
 */
export const leaveTeam = createServerFn({ method: "POST" })
  .inputValidator((teamId: string) => teamId)
  .handler(async ({ data: teamId }) => {
    const db = createDrizzle(env.DB);
    const userId = await getAuthenticatedUserId();

    // Verify team exists
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId),
    });
    if (!team) {
      throw new Error("Team not found");
    }

    // Owner cannot leave (must delete team instead)
    if (team.ownerId === userId) {
      throw new Error("Owner cannot leave. Delete the team instead.");
    }

    // Check if user is member
    const isMember = await queries.isTeamMember(db, teamId, userId);
    if (!isMember) {
      throw new Error("Not a member of this team");
    }

    // Just remove membership - no visibility reset needed
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)));

    logger.info("User left team", { teamId, userId });
    return { success: true };
  });

/**
 * Add member by email (owner only)
 */
export const addMemberByEmail = createServerFn({ method: "POST" })
  .inputValidator((input: { teamId: string; email: string }) => input)
  .handler(async ({ data: { teamId, email } }) => {
    const db = createDrizzle(env.DB);
    const { userId, session } = await requireActiveUser(getRequestHeaders(), db);

    // Verify team exists and user is owner
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId),
    });
    if (!team) {
      throw new Error("Team not found");
    }
    if (team.ownerId !== userId) {
      throw new Error("Only the owner can add members");
    }

    // Find user by email (case-insensitive)
    const targetUser = await queries.findUserByEmail(db, email);
    if (!targetUser) {
      throw new Error("User not found. They must sign up first.");
    }

    // Check if target user is already in a team
    const existingMembership = await db.query.teamMembers.findFirst({
      where: eq(teamMembers.userId, targetUser.id),
    });
    if (existingMembership) {
      throw new Error("User is already in a team");
    }

    // Add member and upgrade from waitlist if needed
    const targetRole = await queries.getUserRole(db, targetUser.id);
    if (targetRole === "waitlist") {
      await db.transaction(async (tx) => {
        await tx.insert(teamMembers).values({ teamId, userId: targetUser.id });
        await tx.update(user).set({ role: "user" }).where(eq(user.id, targetUser.id));
      });
      logger.info("Member added to team and upgraded from waitlist", {
        teamId,
        memberId: targetUser.id,
        addedBy: userId,
      });
    } else {
      const insertMember = db.insert(teamMembers).values({ teamId, userId: targetUser.id });
      await insertMember;
      logger.info("Member added to team", { teamId, memberId: targetUser.id, addedBy: userId });
    }

    // Send notification email to the added member
    const { sendTeamAddedEmail } = await import("./email/send");
    sendTeamAddedEmail(targetUser.email, targetUser.name, team.name, session.user.name ?? "A team member").catch(
      (err) => {
        logger.error("Failed to send team added email", { error: err });
      },
    );

    return { success: true, userId: targetUser.id };
  });

/**
 * Remove member (owner only, cannot remove self)
 */
export const removeMember = createServerFn({ method: "POST" })
  .inputValidator((input: { teamId: string; targetUserId: string }) => input)
  .handler(async ({ data: { teamId, targetUserId } }) => {
    const db = createDrizzle(env.DB);
    const userId = await getAuthenticatedUserId();

    // Verify team exists and user is owner
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId),
    });
    if (!team) {
      throw new Error("Team not found");
    }
    if (team.ownerId !== userId) {
      throw new Error("Only the owner can remove members");
    }

    // Cannot remove owner
    if (targetUserId === team.ownerId) {
      throw new Error("Cannot remove the owner. Delete the team instead.");
    }

    // Check if target is actually a member
    const isMember = await queries.isTeamMember(db, teamId, targetUserId);
    if (!isMember) {
      throw new Error("User is not a member of this team");
    }

    // Just remove membership - access control handles visibility
    // (owner must still be in sharedWithTeamId team for transcripts to be visible)
    await db.delete(teamMembers).where(and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, targetUserId)));

    logger.info("Member removed from team", { teamId, memberId: targetUserId, removedBy: userId });
    return { success: true };
  });

/**
 * Generate invite link (owner only)
 */
export const generateInvite = createServerFn({ method: "POST" })
  .inputValidator((teamId: string) => teamId)
  .handler(async ({ data: teamId }) => {
    const db = createDrizzle(env.DB);
    const userId = await getAuthenticatedUserId();

    // Verify team exists and user is owner
    const team = await db.query.teams.findFirst({
      where: eq(teams.id, teamId),
    });
    if (!team) {
      throw new Error("Team not found");
    }
    if (team.ownerId !== userId) {
      throw new Error("Only the owner can generate invites");
    }

    // Delete existing invite if any
    await db.delete(teamInvites).where(eq(teamInvites.teamId, teamId));

    // Generate new invite (16 chars = ~95 bits entropy)
    const code = crypto.randomUUID().replace(/-/g, "").slice(0, 16);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await db.insert(teamInvites).values({
      teamId,
      code,
      expiresAt,
    });

    logger.info("Invite generated", { teamId, code });
    return { code, url: `/join/${code}`, expiresAt };
  });

/**
 * Get invite info (public - used in join page loader)
 */
export const getInviteInfo = createServerFn({ method: "GET" })
  .inputValidator((code: string) => code)
  .handler(async ({ data: code }) => {
    const db = createDrizzle(env.DB);

    const invite = await queries.getInviteByCode(db, code);
    if (!invite) {
      return null;
    }

    const isExpired = new Date(invite.expiresAt) < new Date();

    return {
      code: invite.code,
      teamName: invite.team.name,
      memberCount: invite.team.members.length,
      ownerName: invite.team.owner.name,
      expired: isExpired,
    };
  });

/**
 * Accept invite (authenticated users only)
 */
export const acceptInvite = createServerFn({ method: "POST" })
  .inputValidator((code: string) => code)
  .handler(async ({ data: code }) => {
    const db = createDrizzle(env.DB);
    const userId = await getAuthenticatedUserId();

    const invite = await queries.getInviteByCode(db, code);
    if (!invite) {
      throw new Error("Invite not found or has been revoked");
    }

    if (new Date(invite.expiresAt) < new Date()) {
      throw new Error("This invite has expired. Please ask for a new one.");
    }

    // Check if user is already in a team
    const existingMembership = await db.query.teamMembers.findFirst({
      where: eq(teamMembers.userId, userId),
    });
    if (existingMembership) {
      throw new Error("Already in a team. Leave current team first.");
    }

    // Add user to team and upgrade from waitlist if needed
    const currentRole = await queries.getUserRole(db, userId);
    if (currentRole === "waitlist") {
      await db.transaction(async (tx) => {
        await tx.insert(teamMembers).values({ teamId: invite.teamId, userId });
        await tx.update(user).set({ role: "user" }).where(eq(user.id, userId));
      });
      logger.info("User joined team via invite and upgraded from waitlist", {
        teamId: invite.teamId,
        userId,
        code,
      });
    } else {
      const insertMember = db.insert(teamMembers).values({ teamId: invite.teamId, userId });
      await insertMember;
      logger.info("User joined team via invite", { teamId: invite.teamId, userId, code });
    }

    return { success: true, teamId: invite.teamId };
  });

/**
 * Update transcript title (summary)
 * Only owners and admins can update the title
 */
export const updateTitle = createServerFn({ method: "POST" })
  .inputValidator((input: { transcriptId: string; title: string }) => input)
  .handler(async ({ data: { transcriptId, title } }) => {
    const db = createDrizzle(env.DB);
    const userId = await getAuthenticatedUserId();

    // Get user role to check if admin
    const userRole = await queries.getUserRole(db, userId);
    const isAdmin = userRole === "admin";

    // Verify transcript exists
    const transcript = await db.query.transcripts.findFirst({
      where: eq(transcripts.id, transcriptId),
    });
    if (!transcript) {
      throw new Error("Transcript not found");
    }

    // Check if user is owner or admin
    if (transcript.userId !== userId && !isAdmin) {
      throw new Error("You can only change the title of your own transcripts");
    }

    // Update title (summary field)
    const trimmedTitle = title.trim() || null;
    await db.update(transcripts).set({ summary: trimmedTitle }).where(eq(transcripts.id, transcriptId));

    logger.info("Transcript title updated", { transcriptId, title: trimmedTitle, userId });
    return { success: true, title: trimmedTitle };
  });

/**
 * Update transcript visibility
 * When setting to 'team', also stores the specific sharedWithTeamId
 */
export const updateVisibility = createServerFn({ method: "POST" })
  .inputValidator((input: { transcriptId: string; visibility: string }) => input)
  .handler(async ({ data: { transcriptId, visibility } }) => {
    const db = createDrizzle(env.DB);
    const userId = await getAuthenticatedUserId();

    // Verify transcript exists and user owns it
    const transcript = await db.query.transcripts.findFirst({
      where: eq(transcripts.id, transcriptId),
    });
    if (!transcript) {
      throw new Error("Transcript not found");
    }
    if (transcript.userId !== userId) {
      throw new Error("You can only change visibility of your own transcripts");
    }

    // Validate visibility value
    if (!visibility || !visibilityOptions.includes(visibility as VisibilityOption)) {
      throw new Error(`Invalid visibility. Must be one of: ${visibilityOptions.join(", ")}`);
    }

    // Determine sharedWithTeamId based on visibility
    let sharedWithTeamId: string | null = null;
    if (visibility === "team") {
      const userTeam = await queries.getUserTeam(db, userId);
      if (!userTeam) {
        throw new Error("You must be in a team to share with team. Create or join a team first.");
      }
      sharedWithTeamId = userTeam.id;
    }

    // Update visibility AND sharedWithTeamId together
    await db
      .update(transcripts)
      .set({
        visibility: visibility as VisibilityOption,
        sharedWithTeamId, // null for private/public, teamId for team
      })
      .where(eq(transcripts.id, transcriptId));

    logger.info("Transcript visibility updated", { transcriptId, visibility, sharedWithTeamId, userId });
    return { success: true, visibility, sharedWithTeamId };
  });

/**
 * Delete a transcript
 * Only owners and admins can delete transcripts
 * Deletes the transcript record and the unified transcript file from R2
 * Does NOT delete associated blobs (they may be shared with other transcripts)
 */
export const deleteTranscript = createServerFn({ method: "POST" })
  .inputValidator((input: { transcriptId: string }) => input)
  .handler(async ({ data: { transcriptId } }) => {
    const db = createDrizzle(env.DB);
    const userId = await getAuthenticatedUserId();

    // Get user role to check if admin
    const userRole = await queries.getUserRole(db, userId);
    const isAdmin = userRole === "admin";

    // Get transcript with repo info for R2 key construction
    const transcript = await db.query.transcripts.findFirst({
      where: eq(transcripts.id, transcriptId),
      with: {
        repo: {
          columns: { repo: true },
        },
      },
    });

    if (!transcript) {
      throw new Error("Transcript not found");
    }

    // Check if user is owner or admin
    if (transcript.userId !== userId && !isAdmin) {
      throw new Error("You can only delete your own transcripts");
    }

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
    await db.delete(transcripts).where(eq(transcripts.id, transcriptId));

    logger.info("Transcript deleted successfully", {
      transcriptId,
      transcriptUuid: transcript.transcriptId,
      deletedBy: userId,
      isAdmin,
    });

    return { success: true };
  });

// =============================================================================
// Orchestrating Server Functions (one per loader)
// =============================================================================

/**
 * Get all data needed for the join page
 * Consolidates getInviteInfo, getSession, and getTeam into a single RPC call
 */
export const getJoinPageData = createServerFn({ method: "GET" })
  .inputValidator((code: string) => code)
  .handler(async ({ data: code }) => {
    const db = createDrizzle(env.DB);
    const auth = createAuth();
    const headers = getRequestHeaders();

    // Fetch invite info (public, doesn't need auth)
    const invite = await queries.getInviteByCode(db, code);
    const inviteData = invite
      ? {
          code: invite.code,
          teamName: invite.team.name,
          memberCount: invite.team.members.length,
          ownerName: invite.team.owner.name,
          expired: new Date(invite.expiresAt) < new Date(),
        }
      : null;

    // Fetch session (may be null for unauthenticated users)
    let session: Awaited<ReturnType<typeof auth.api.getSession>> = null;
    try {
      session = await auth.api.getSession({ headers });
    } catch {
      // Session fetch failed, user is not authenticated
    }

    // Fetch current team (only if authenticated)
    let currentTeam: Awaited<ReturnType<typeof queries.getUserTeam>> = null;
    if (session?.user) {
      currentTeam = await queries.getUserTeam(db, session.user.id);
    }

    return { invite: inviteData, session, currentTeam, code };
  });

/**
 * Get all data needed for the admin page
 * Consolidates getAdminStats and getAdminUsers into a single RPC call
 */
export const getAdminPageData = createServerFn({ method: "GET" }).handler(async () => {
  await requireAdmin();
  const db = createDrizzle(env.DB);

  const [stats, users] = await Promise.all([queries.getAdminAggregateStats(db), queries.getAdminUserStats(db)]);

  return { stats, users };
});

/**
 * Get all data needed for the team members page
 * Consolidates getTeam and getSession into a single RPC call
 */
export const getTeamPageData = createServerFn({ method: "GET" }).handler(async () => {
  const db = createDrizzle(env.DB);
  const { userId, session } = await requireActiveUser(getRequestHeaders(), db);
  const team = await queries.getUserTeam(db, userId);
  return { team, session };
});

/**
 * Get all data needed for the team dashboard page
 * Includes team info, aggregate stats, member stats, daily activity, model usage, and agent usage
 */
export const getTeamDashboardData = createServerFn({ method: "GET" })
  .inputValidator((input: { days?: number }) => {
    const days = input.days ?? 30;
    if (days < 1 || days > 365) {
      throw new Error("Days must be between 1 and 365");
    }
    return { days };
  })
  .handler(async ({ data: { days } }) => {
    const db = createDrizzle(env.DB);
    const { userId, session } = await requireActiveUser(getRequestHeaders(), db);
    const team = await queries.getUserTeam(db, userId);

    // If no team, return early with null stats
    if (!team) {
      return {
        team: null,
        stats: null,
        memberStats: [],
        activity: [],
        userNames: [],
        isHourly: false,
        modelUsage: [],
        agentUsage: [],
        session,
      };
    }

    // Fetch all dashboard data in parallel
    const [stats, memberStats, activityByUser, modelUsage, agentUsage] = await Promise.all([
      queries.getTeamStats(db, team.id, days),
      queries.getTeamMemberStats(db, team.id, days),
      queries.getTeamActivityByUser(db, team.id, days),
      queries.getTeamModelUsage(db, team.id, days),
      queries.getTeamAgentUsage(db, team.id, days),
    ]);

    // Transform per-user activity into chart format
    // Each row: { period, [userName]: count, ... }
    const userNames = [...new Set(activityByUser.map((r) => r.userName))];
    const periodMap = new Map<string, Record<string, number>>();

    for (const row of activityByUser) {
      if (!periodMap.has(row.period)) {
        periodMap.set(row.period, {});
      }
      const periodData = periodMap.get(row.period)!;
      periodData[row.userName || "Unknown"] = row.count;
    }

    // Fill in missing periods (hours for 24h, days otherwise)
    const activity: Array<Record<string, string | number>> = [];
    const now = new Date();
    const isHourly = days === 1;

    if (isHourly) {
      // Fill 24 hours (using UTC to match SQL unixepoch)
      for (let i = 23; i >= 0; i--) {
        const date = new Date(now);
        date.setUTCHours(date.getUTCHours() - i, 0, 0, 0);
        const key = `${date.toISOString().split("T")[0]} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
        const periodData = periodMap.get(key) ?? {};
        const row: Record<string, string | number> = { period: key };
        for (const name of userNames) {
          row[name || "Unknown"] = periodData[name || "Unknown"] ?? 0;
        }
        activity.push(row);
      }
    } else {
      // Fill days
      for (let i = days - 1; i >= 0; i--) {
        const date = new Date(now);
        date.setDate(date.getDate() - i);
        const key = date.toISOString().split("T")[0];
        const periodData = periodMap.get(key) ?? {};
        const row: Record<string, string | number> = { period: key };
        for (const name of userNames) {
          row[name || "Unknown"] = periodData[name || "Unknown"] ?? 0;
        }
        activity.push(row);
      }
    }

    return { team, stats, memberStats, activity, userNames, isHourly, modelUsage, agentUsage, session };
  });

/**
 * Get all data needed for the home page
 * Consolidates getTranscriptsPaginated, getDailyActivity, and getRepos into a single RPC call
 */
export const getHomePageData = createServerFn({ method: "GET" }).handler(async () => {
  const db = createDrizzle(env.DB);
  const userId = await getAuthenticatedUserId();

  const [paginatedResult, repos, dailyActivityResults] = await Promise.all([
    queries.getTranscriptsPaginated(db, userId, { limit: PAGE_SIZE }),
    queries.getRepos(db, userId),
    queries.getDailyActivityCounts(db, userId),
  ]);

  // Transform paginated result
  const initialData = {
    items: paginatedResult.items.map((t) => ({
      id: t.id,
      repoId: t.repoId,
      transcriptId: t.transcriptId,
      source: t.source,
      preview: t.preview,
      summary: t.summary,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      messageCount: t.messageCount,
      toolCount: t.toolCount,
      userMessageCount: t.userMessageCount,
      filesChanged: t.filesChanged,
      linesAdded: t.linesAdded,
      linesRemoved: t.linesRemoved,
      linesModified: t.linesModified,
      costUsd: t.costUsd,
      userName: t.userName,
      userImage: t.userImage,
      repoName: t.repoName,
      branch: t.branch,
      cwd: t.cwd,
      visibility: t.visibility,
      previewBlobSha256: (t as typeof t & { previewBlobSha256?: string | null }).previewBlobSha256 ?? null,
    })),
    nextCursor: paginatedResult.nextCursor
      ? { createdAt: paginatedResult.nextCursor.createdAt.toISOString(), id: paginatedResult.nextCursor.id }
      : null,
    hasMore: paginatedResult.hasMore,
  };

  // Fill in missing days for daily activity
  const counts = new Map<string, number>(dailyActivityResults.map((r) => [r.date, r.count]));
  const dailyActivity: Array<{ date: string; count: number }> = [];
  const today = new Date();
  for (let i = 29; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().split("T")[0];
    dailyActivity.push({ date: key, count: counts.get(key) ?? 0 });
  }

  return { initialData, dailyActivity, repos };
});
