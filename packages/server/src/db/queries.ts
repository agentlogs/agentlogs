import { and, count, desc, eq, exists, isNull, like, lt, or, sql } from "drizzle-orm";
import type { DrizzleDB } from ".";
import { repos, teamInvites, teamMembers, teams, transcripts, user, type UserRole } from "./schema";

/**
 * Get repos from transcripts visible to the user.
 * Only returns repos that appear in transcripts the user can access.
 */
export async function getRepos(db: DrizzleDB, viewerId: string) {
  return await db
    .select({
      id: repos.id,
      repo: repos.repo,
      lastActivity: repos.lastActivity,
      createdAt: repos.createdAt,
      transcriptCount: sql<number>`CAST(COUNT(${transcripts.id}) AS INTEGER)`.as("transcript_count"),
    })
    .from(repos)
    .innerJoin(transcripts, eq(transcripts.repoId, repos.id))
    .where(buildVisibilityCondition(viewerId))
    .groupBy(repos.id)
    .orderBy(desc(repos.lastActivity));
}

/**
 * Get transcripts for a specific repo
 */
export async function getTranscriptsByRepo(db: DrizzleDB, userId: string, repoId: string) {
  return await db
    .select({
      id: transcripts.id,
      repoId: transcripts.repoId,
      userId: transcripts.userId,
      sha256: transcripts.sha256,
      transcriptId: transcripts.transcriptId,
      source: transcripts.source,
      createdAt: transcripts.createdAt,
      preview: transcripts.preview,
      model: transcripts.model,
      costUsd: transcripts.costUsd,
      blendedTokens: transcripts.blendedTokens,
      messageCount: transcripts.messageCount,
      userMessageCount: transcripts.userMessageCount,
      linesAdded: transcripts.linesAdded,
      linesRemoved: transcripts.linesRemoved,
      linesModified: transcripts.linesModified,
      inputTokens: transcripts.inputTokens,
      cachedInputTokens: transcripts.cachedInputTokens,
      outputTokens: transcripts.outputTokens,
      reasoningOutputTokens: transcripts.reasoningOutputTokens,
      totalTokens: transcripts.totalTokens,
      relativeCwd: transcripts.relativeCwd,
      branch: transcripts.branch,
      cwd: transcripts.cwd,
      updatedAt: transcripts.updatedAt,
      userName: user.name,
      userImage: user.image,
    })
    .from(transcripts)
    .leftJoin(user, eq(transcripts.userId, user.id))
    .where(and(eq(transcripts.repoId, repoId), eq(transcripts.userId, userId)))
    .orderBy(desc(transcripts.createdAt));
}

/**
 * Get a single transcript with its repo (using relations)
 */
export async function getTranscript(db: DrizzleDB, userId: string, id: string) {
  return await db.query.transcripts.findFirst({
    where: and(eq(transcripts.id, id), eq(transcripts.userId, userId)),
    with: {
      repo: true,
      user: true,
    },
  });
}

/**
 * Get a transcript by its session/transcript ID for a user.
 */
export async function getTranscriptByTranscriptId(db: DrizzleDB, userId: string, transcriptId: string) {
  return await db.query.transcripts.findFirst({
    columns: {
      id: true,
      transcriptId: true,
    },
    where: and(eq(transcripts.transcriptId, transcriptId), eq(transcripts.userId, userId)),
  });
}

/**
 * Get a transcript by its database ID or transcriptId.
 * First tries to find by ID (CUID2), then falls back to transcriptId lookup.
 */
export async function getTranscriptByIdOrTranscriptId(db: DrizzleDB, userId: string, param: string) {
  // First try lookup by id (CUID2)
  const byId = await db.query.transcripts.findFirst({
    columns: {
      id: true,
      transcriptId: true,
    },
    where: and(eq(transcripts.id, param), eq(transcripts.userId, userId)),
  });

  if (byId) {
    return byId;
  }

  // Fall back to lookup by transcriptId
  return await db.query.transcripts.findFirst({
    columns: {
      id: true,
      transcriptId: true,
    },
    where: and(eq(transcripts.transcriptId, param), eq(transcripts.userId, userId)),
  });
}

/**
 * Get private transcripts (no repo) grouped by cwd
 */
export async function getPrivateTranscriptsByCwd(db: DrizzleDB, userId: string) {
  const results = await db
    .select({
      cwd: transcripts.cwd,
      transcriptCount: sql<number>`CAST(COUNT(${transcripts.id}) AS INTEGER)`.as("transcript_count"),
    })
    .from(transcripts)
    .where(and(eq(transcripts.userId, userId), isNull(transcripts.repoId)))
    .groupBy(transcripts.cwd)
    .orderBy(desc(sql`MAX(${transcripts.createdAt})`));

  return results;
}

/**
 * Get transcripts for a specific cwd (private transcripts)
 */
export async function getTranscriptsByCwd(db: DrizzleDB, userId: string, cwd: string) {
  return await db
    .select({
      id: transcripts.id,
      repoId: transcripts.repoId,
      userId: transcripts.userId,
      sha256: transcripts.sha256,
      transcriptId: transcripts.transcriptId,
      source: transcripts.source,
      createdAt: transcripts.createdAt,
      preview: transcripts.preview,
      model: transcripts.model,
      costUsd: transcripts.costUsd,
      blendedTokens: transcripts.blendedTokens,
      messageCount: transcripts.messageCount,
      userMessageCount: transcripts.userMessageCount,
      linesAdded: transcripts.linesAdded,
      linesRemoved: transcripts.linesRemoved,
      linesModified: transcripts.linesModified,
      inputTokens: transcripts.inputTokens,
      cachedInputTokens: transcripts.cachedInputTokens,
      outputTokens: transcripts.outputTokens,
      reasoningOutputTokens: transcripts.reasoningOutputTokens,
      totalTokens: transcripts.totalTokens,
      relativeCwd: transcripts.relativeCwd,
      branch: transcripts.branch,
      cwd: transcripts.cwd,
      updatedAt: transcripts.updatedAt,
      userName: user.name,
      userImage: user.image,
    })
    .from(transcripts)
    .leftJoin(user, eq(transcripts.userId, user.id))
    .where(and(eq(transcripts.userId, userId), isNull(transcripts.repoId), eq(transcripts.cwd, cwd)))
    .orderBy(desc(transcripts.createdAt));
}

/**
 * Get all transcripts for a user, sorted chronologically (newest first)
 */
export async function getAllTranscripts(db: DrizzleDB, userId: string) {
  return await db
    .select({
      id: transcripts.id,
      repoId: transcripts.repoId,
      userId: transcripts.userId,
      sha256: transcripts.sha256,
      transcriptId: transcripts.transcriptId,
      source: transcripts.source,
      createdAt: transcripts.createdAt,
      preview: transcripts.preview,
      summary: transcripts.summary,
      model: transcripts.model,
      costUsd: transcripts.costUsd,
      blendedTokens: transcripts.blendedTokens,
      messageCount: transcripts.messageCount,
      toolCount: transcripts.toolCount,
      userMessageCount: transcripts.userMessageCount,
      filesChanged: transcripts.filesChanged,
      linesAdded: transcripts.linesAdded,
      linesRemoved: transcripts.linesRemoved,
      linesModified: transcripts.linesModified,
      inputTokens: transcripts.inputTokens,
      cachedInputTokens: transcripts.cachedInputTokens,
      outputTokens: transcripts.outputTokens,
      reasoningOutputTokens: transcripts.reasoningOutputTokens,
      totalTokens: transcripts.totalTokens,
      relativeCwd: transcripts.relativeCwd,
      branch: transcripts.branch,
      cwd: transcripts.cwd,
      updatedAt: transcripts.updatedAt,
      visibility: transcripts.visibility,
      userName: user.name,
      userImage: user.image,
      repoName: repos.repo,
    })
    .from(transcripts)
    .leftJoin(user, eq(transcripts.userId, user.id))
    .leftJoin(repos, eq(transcripts.repoId, repos.id))
    .where(eq(transcripts.userId, userId))
    .orderBy(desc(transcripts.createdAt));
}

export interface PaginatedTranscriptsParams {
  cursor?: { createdAt: Date; id: string };
  limit: number;
  search?: string;
  repoId?: string | null; // null = private only (no repo), undefined = all
}

export interface PaginatedTranscriptsResult {
  items: Awaited<ReturnType<typeof getAllTranscripts>>;
  nextCursor: { createdAt: Date; id: string } | null;
  hasMore: boolean;
}

/**
 * Get transcripts for a user with cursor-based pagination
 */
export async function getTranscriptsPaginated(
  db: DrizzleDB,
  userId: string,
  params: PaginatedTranscriptsParams,
): Promise<PaginatedTranscriptsResult> {
  const { cursor, limit, search, repoId } = params;

  // Build conditions - use visibility-based access control
  const conditions = [buildVisibilityCondition(userId)];

  if (cursor) {
    // Cursor comparison: (createdAt, id) < (cursor.createdAt, cursor.id)
    // This means: createdAt < cursor.createdAt OR (createdAt = cursor.createdAt AND id < cursor.id)
    conditions.push(
      or(
        lt(transcripts.createdAt, cursor.createdAt),
        and(eq(transcripts.createdAt, cursor.createdAt), lt(transcripts.id, cursor.id)),
      )!,
    );
  }

  // Search filter - searches summary and preview (first prompt)
  if (search) {
    const searchPattern = `%${search}%`;
    conditions.push(or(like(transcripts.summary, searchPattern), like(transcripts.preview, searchPattern))!);
  }

  // Repo filter - null means private only, undefined means all
  if (repoId !== undefined) {
    if (repoId === null) {
      conditions.push(isNull(transcripts.repoId));
    } else {
      conditions.push(eq(transcripts.repoId, repoId));
    }
  }

  const items = await db
    .select({
      id: transcripts.id,
      repoId: transcripts.repoId,
      userId: transcripts.userId,
      sha256: transcripts.sha256,
      transcriptId: transcripts.transcriptId,
      source: transcripts.source,
      createdAt: transcripts.createdAt,
      preview: transcripts.preview,
      summary: transcripts.summary,
      model: transcripts.model,
      costUsd: transcripts.costUsd,
      blendedTokens: transcripts.blendedTokens,
      messageCount: transcripts.messageCount,
      toolCount: transcripts.toolCount,
      userMessageCount: transcripts.userMessageCount,
      filesChanged: transcripts.filesChanged,
      linesAdded: transcripts.linesAdded,
      linesRemoved: transcripts.linesRemoved,
      linesModified: transcripts.linesModified,
      inputTokens: transcripts.inputTokens,
      cachedInputTokens: transcripts.cachedInputTokens,
      outputTokens: transcripts.outputTokens,
      reasoningOutputTokens: transcripts.reasoningOutputTokens,
      totalTokens: transcripts.totalTokens,
      relativeCwd: transcripts.relativeCwd,
      branch: transcripts.branch,
      cwd: transcripts.cwd,
      previewBlobSha256: transcripts.previewBlobSha256,
      updatedAt: transcripts.updatedAt,
      visibility: transcripts.visibility,
      userName: user.name,
      userImage: user.image,
      repoName: repos.repo,
    })
    .from(transcripts)
    .leftJoin(user, eq(transcripts.userId, user.id))
    .leftJoin(repos, eq(transcripts.repoId, repos.id))
    .where(and(...conditions))
    .orderBy(desc(transcripts.createdAt), desc(transcripts.id))
    .limit(limit + 1);

  const hasMore = items.length > limit;
  const returnItems = hasMore ? items.slice(0, limit) : items;

  const lastItem = returnItems[returnItems.length - 1];
  const nextCursor = hasMore && lastItem ? { createdAt: lastItem.createdAt, id: lastItem.id } : null;

  return { items: returnItems, nextCursor, hasMore };
}

/**
 * Get user by ID with role
 */
export async function getUserById(db: DrizzleDB, userId: string) {
  return await db.query.user.findFirst({
    where: eq(user.id, userId),
  });
}

/**
 * Get user role by ID
 */
export async function getUserRole(db: DrizzleDB, userId: string): Promise<UserRole | null> {
  const result = await db.select({ role: user.role }).from(user).where(eq(user.id, userId)).limit(1);
  return (result[0]?.role as UserRole) ?? null;
}

/**
 * Update user role by ID (admin only)
 */
export async function updateUserRole(db: DrizzleDB, userId: string, newRole: UserRole): Promise<void> {
  await db.update(user).set({ role: newRole }).where(eq(user.id, userId));
}

// =============================================================================
// Admin Queries
// =============================================================================

/**
 * Get all users with their transcript counts (admin only)
 */
export async function getAdminUserStats(db: DrizzleDB) {
  return await db
    .select({
      id: user.id,
      name: user.name,
      username: user.username,
      email: user.email,
      image: user.image,
      role: user.role,
      createdAt: user.createdAt,
      welcomeEmailSentAt: user.welcomeEmailSentAt,
      transcriptCount: sql<number>`CAST(COUNT(${transcripts.id}) AS INTEGER)`.as("transcript_count"),
      totalCost: sql<number>`COALESCE(SUM(${transcripts.costUsd}), 0)`.as("total_cost"),
    })
    .from(user)
    .leftJoin(transcripts, eq(transcripts.userId, user.id))
    .groupBy(user.id)
    .orderBy(desc(user.createdAt));
}

/**
 * Mark welcome email as sent for a user
 */
export async function markWelcomeEmailSent(db: DrizzleDB, userId: string): Promise<void> {
  await db.update(user).set({ welcomeEmailSentAt: new Date() }).where(eq(user.id, userId));
}

/**
 * Get aggregate stats for the admin dashboard
 */
export async function getAdminAggregateStats(db: DrizzleDB) {
  const [userStats] = await db
    .select({
      totalUsers: count(user.id),
      waitlistUsers: sql<number>`CAST(SUM(CASE WHEN ${user.role} = 'waitlist' THEN 1 ELSE 0 END) AS INTEGER)`,
      activeUsers: sql<number>`CAST(SUM(CASE WHEN ${user.role} = 'user' THEN 1 ELSE 0 END) AS INTEGER)`,
      adminUsers: sql<number>`CAST(SUM(CASE WHEN ${user.role} = 'admin' THEN 1 ELSE 0 END) AS INTEGER)`,
    })
    .from(user);

  const [transcriptStats] = await db
    .select({
      totalTranscripts: count(transcripts.id),
      totalCost: sql<number>`COALESCE(SUM(${transcripts.costUsd}), 0)`,
      totalTokens: sql<number>`COALESCE(SUM(${transcripts.totalTokens}), 0)`,
      totalMessages: sql<number>`COALESCE(SUM(${transcripts.messageCount}), 0)`,
    })
    .from(transcripts);

  const [repoStats] = await db.select({ totalRepos: count(repos.id) }).from(repos);

  return {
    ...userStats,
    ...transcriptStats,
    ...repoStats,
  };
}

// =============================================================================
// Team Queries
// =============================================================================

/**
 * Get user's current team (0 or 1)
 * Returns null if user is not in any team
 */
export async function getUserTeam(db: DrizzleDB, userId: string) {
  const membership = await db.query.teamMembers.findFirst({
    where: eq(teamMembers.userId, userId),
    with: {
      team: {
        with: {
          owner: true,
          members: { with: { user: true } },
        },
      },
    },
  });
  return membership?.team ?? null;
}

/**
 * Get team by ID with members
 */
export async function getTeamWithMembers(db: DrizzleDB, teamId: string) {
  return db.query.teams.findFirst({
    where: eq(teams.id, teamId),
    with: {
      owner: true,
      members: { with: { user: true } },
      invites: true,
    },
  });
}

/**
 * Check if user is team owner
 */
export async function isTeamOwner(db: DrizzleDB, teamId: string, userId: string) {
  const team = await db.query.teams.findFirst({
    where: and(eq(teams.id, teamId), eq(teams.ownerId, userId)),
  });
  return !!team;
}

/**
 * Check if user is team member
 */
export async function isTeamMember(db: DrizzleDB, teamId: string, userId: string) {
  const member = await db.query.teamMembers.findFirst({
    where: and(eq(teamMembers.teamId, teamId), eq(teamMembers.userId, userId)),
  });
  return !!member;
}

/**
 * Find user by email (case-insensitive)
 */
export async function findUserByEmail(db: DrizzleDB, email: string) {
  const result = await db
    .select()
    .from(user)
    .where(sql`LOWER(${user.email}) = LOWER(${email})`)
    .limit(1);
  return result[0] ?? null;
}

/**
 * Get invite by code
 */
export async function getInviteByCode(db: DrizzleDB, code: string) {
  return db.query.teamInvites.findFirst({
    where: eq(teamInvites.code, code),
    with: {
      team: {
        with: {
          owner: true,
          members: true,
        },
      },
    },
  });
}

// =============================================================================
// Access Control Queries
// =============================================================================

/**
 * Build WHERE clause for transcript visibility.
 * Returns SQL condition that matches transcripts the viewer can access.
 *
 * Rules:
 * 1. Owner always sees their own transcripts
 * 2. Team transcripts visible if:
 *    - Viewer is in the sharedWithTeamId team AND
 *    - Owner is ALSO still in that team (prevents stale sharing after owner leaves)
 * 3. Public transcripts from team members (viewer and owner share a team)
 */
function buildVisibilityCondition(viewerId: string) {
  return or(
    // 1. Owner sees own transcripts
    eq(transcripts.userId, viewerId),
    // 2. Team transcripts where viewer AND owner are both in the shared team
    and(
      eq(transcripts.visibility, "team"),
      // Viewer is in the sharedWithTeamId team
      exists(
        sql`(SELECT 1 FROM ${teamMembers} AS viewer_tm
            WHERE viewer_tm.team_id = ${transcripts.sharedWithTeamId}
            AND viewer_tm.user_id = ${viewerId})`,
      ),
      // Owner is ALSO in the sharedWithTeamId team
      exists(
        sql`(SELECT 1 FROM ${teamMembers} AS owner_tm
            WHERE owner_tm.team_id = ${transcripts.sharedWithTeamId}
            AND owner_tm.user_id = ${transcripts.userId})`,
      ),
    ),
    // 3. Public transcripts from team members (viewer and owner share a team)
    and(
      eq(transcripts.visibility, "public"),
      exists(
        sql`(SELECT 1 FROM ${teamMembers} AS viewer_tm
            INNER JOIN ${teamMembers} AS owner_tm ON viewer_tm.team_id = owner_tm.team_id
            WHERE viewer_tm.user_id = ${viewerId}
            AND owner_tm.user_id = ${transcripts.userId})`,
      ),
    ),
  );
}

/**
 * Get a single transcript with access control.
 * Returns null if not found or viewer cannot access.
 */
export async function getTranscriptWithAccess(db: DrizzleDB, viewerId: string, id: string) {
  const results = await db
    .select({
      id: transcripts.id,
      repoId: transcripts.repoId,
      userId: transcripts.userId,
      sha256: transcripts.sha256,
      transcriptId: transcripts.transcriptId,
      source: transcripts.source,
      createdAt: transcripts.createdAt,
      preview: transcripts.preview,
      summary: transcripts.summary,
      model: transcripts.model,
      costUsd: transcripts.costUsd,
      blendedTokens: transcripts.blendedTokens,
      messageCount: transcripts.messageCount,
      inputTokens: transcripts.inputTokens,
      cachedInputTokens: transcripts.cachedInputTokens,
      outputTokens: transcripts.outputTokens,
      reasoningOutputTokens: transcripts.reasoningOutputTokens,
      totalTokens: transcripts.totalTokens,
      relativeCwd: transcripts.relativeCwd,
      branch: transcripts.branch,
      cwd: transcripts.cwd,
      updatedAt: transcripts.updatedAt,
      visibility: transcripts.visibility,
      sharedWithTeamId: transcripts.sharedWithTeamId,
      linesAdded: transcripts.linesAdded,
      linesRemoved: transcripts.linesRemoved,
      linesModified: transcripts.linesModified,
      userName: user.name,
      userUsername: user.username,
      userImage: user.image,
      repoName: repos.repo,
    })
    .from(transcripts)
    .leftJoin(user, eq(transcripts.userId, user.id))
    .leftJoin(repos, eq(transcripts.repoId, repos.id))
    .where(and(eq(transcripts.id, id), or(buildVisibilityCondition(viewerId), eq(transcripts.visibility, "public"))))
    .limit(1);

  return results[0] ?? null;
}

/**
 * Get a public transcript by ID.
 * Does NOT require authentication - only returns transcripts with visibility="public".
 */
export async function getPublicTranscript(db: DrizzleDB, id: string) {
  const results = await db
    .select({
      id: transcripts.id,
      repoId: transcripts.repoId,
      userId: transcripts.userId,
      sha256: transcripts.sha256,
      transcriptId: transcripts.transcriptId,
      source: transcripts.source,
      createdAt: transcripts.createdAt,
      preview: transcripts.preview,
      summary: transcripts.summary,
      model: transcripts.model,
      costUsd: transcripts.costUsd,
      blendedTokens: transcripts.blendedTokens,
      messageCount: transcripts.messageCount,
      inputTokens: transcripts.inputTokens,
      cachedInputTokens: transcripts.cachedInputTokens,
      outputTokens: transcripts.outputTokens,
      reasoningOutputTokens: transcripts.reasoningOutputTokens,
      totalTokens: transcripts.totalTokens,
      relativeCwd: transcripts.relativeCwd,
      branch: transcripts.branch,
      cwd: transcripts.cwd,
      updatedAt: transcripts.updatedAt,
      visibility: transcripts.visibility,
      sharedWithTeamId: transcripts.sharedWithTeamId,
      linesAdded: transcripts.linesAdded,
      linesRemoved: transcripts.linesRemoved,
      linesModified: transcripts.linesModified,
      userName: user.name,
      userUsername: user.username,
      userImage: user.image,
      repoName: repos.repo,
    })
    .from(transcripts)
    .leftJoin(user, eq(transcripts.userId, user.id))
    .leftJoin(repos, eq(transcripts.repoId, repos.id))
    .where(and(eq(transcripts.id, id), eq(transcripts.visibility, "public")))
    .limit(1);

  return results[0] ?? null;
}

/**
 * Get all transcripts visible to a user, sorted chronologically (newest first).
 * Includes: own transcripts, public transcripts, team-shared transcripts.
 */
export async function getVisibleTranscripts(db: DrizzleDB, viewerId: string) {
  return await db
    .select({
      id: transcripts.id,
      repoId: transcripts.repoId,
      userId: transcripts.userId,
      sha256: transcripts.sha256,
      transcriptId: transcripts.transcriptId,
      source: transcripts.source,
      createdAt: transcripts.createdAt,
      preview: transcripts.preview,
      summary: transcripts.summary,
      model: transcripts.model,
      costUsd: transcripts.costUsd,
      blendedTokens: transcripts.blendedTokens,
      messageCount: transcripts.messageCount,
      toolCount: transcripts.toolCount,
      userMessageCount: transcripts.userMessageCount,
      filesChanged: transcripts.filesChanged,
      linesAdded: transcripts.linesAdded,
      linesRemoved: transcripts.linesRemoved,
      linesModified: transcripts.linesModified,
      inputTokens: transcripts.inputTokens,
      cachedInputTokens: transcripts.cachedInputTokens,
      outputTokens: transcripts.outputTokens,
      reasoningOutputTokens: transcripts.reasoningOutputTokens,
      totalTokens: transcripts.totalTokens,
      relativeCwd: transcripts.relativeCwd,
      branch: transcripts.branch,
      cwd: transcripts.cwd,
      updatedAt: transcripts.updatedAt,
      visibility: transcripts.visibility,
      sharedWithTeamId: transcripts.sharedWithTeamId,
      userName: user.name,
      userImage: user.image,
      repoName: repos.repo,
    })
    .from(transcripts)
    .leftJoin(user, eq(transcripts.userId, user.id))
    .leftJoin(repos, eq(transcripts.repoId, repos.id))
    .where(buildVisibilityCondition(viewerId))
    .orderBy(desc(transcripts.createdAt));
}

/**
 * Get daily transcript counts for the past N days for activity chart.
 * Uses visibility-based access control so viewer sees their own + public + team-shared.
 */
export async function getDailyActivityCounts(db: DrizzleDB, viewerId: string, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);
  const startTimestamp = Math.floor(startDate.getTime() / 1000);

  const results = await db
    .select({
      date: sql<string>`DATE(${transcripts.createdAt}, 'unixepoch')`.as("date"),
      count: sql<number>`CAST(COUNT(*) AS INTEGER)`.as("count"),
    })
    .from(transcripts)
    .where(and(buildVisibilityCondition(viewerId), sql`${transcripts.createdAt} >= ${startTimestamp}`))
    .groupBy(sql`DATE(${transcripts.createdAt}, 'unixepoch')`)
    .orderBy(sql`DATE(${transcripts.createdAt}, 'unixepoch')`);

  return results;
}

/**
 * Build condition for transcripts visible to a team.
 * Includes:
 * 1. Team-shared transcripts (visibility='team' AND sharedWithTeamId matches)
 * 2. Public transcripts from any team member
 */
function buildTeamVisibleCondition(teamId: string) {
  return or(
    // Team-shared transcripts
    and(eq(transcripts.visibility, "team"), eq(transcripts.sharedWithTeamId, teamId)),
    // Public transcripts from team members
    and(
      eq(transcripts.visibility, "public"),
      exists(
        sql`(SELECT 1 FROM ${teamMembers} WHERE ${teamMembers.teamId} = ${teamId} AND ${teamMembers.userId} = ${transcripts.userId})`,
      ),
    ),
  );
}

/**
 * Build condition for transcripts visible to a team with date filter.
 */
function buildTeamVisibleConditionWithDate(teamId: string, startTimestamp: number) {
  return and(buildTeamVisibleCondition(teamId), sql`${transcripts.createdAt} >= ${startTimestamp}`);
}

/**
 * Get aggregate stats for transcripts visible to a team within a date range.
 */
export async function getTeamStats(db: DrizzleDB, teamId: string, days: number) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);
  const startTimestamp = Math.floor(startDate.getTime() / 1000);

  const [stats] = await db
    .select({
      totalTranscripts: count(transcripts.id),
      linesAdded: sql<number>`COALESCE(SUM(${transcripts.linesAdded}), 0)`,
      linesRemoved: sql<number>`COALESCE(SUM(${transcripts.linesRemoved}), 0)`,
      linesModified: sql<number>`COALESCE(SUM(${transcripts.linesModified}), 0)`,
    })
    .from(transcripts)
    .where(buildTeamVisibleConditionWithDate(teamId, startTimestamp));

  return stats;
}

/**
 * Get daily transcript counts for a team for the activity chart.
 */
export async function getTeamDailyActivity(db: DrizzleDB, teamId: string, days: number) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);
  const startTimestamp = Math.floor(startDate.getTime() / 1000);

  const results = await db
    .select({
      date: sql<string>`DATE(${transcripts.createdAt}, 'unixepoch')`.as("date"),
      count: sql<number>`CAST(COUNT(*) AS INTEGER)`.as("count"),
    })
    .from(transcripts)
    .where(buildTeamVisibleConditionWithDate(teamId, startTimestamp))
    .groupBy(sql`DATE(${transcripts.createdAt}, 'unixepoch')`)
    .orderBy(sql`DATE(${transcripts.createdAt}, 'unixepoch')`);

  return results;
}

/**
 * Get activity counts grouped by user for a stacked area chart.
 * When days=1, groups by hour; otherwise groups by day.
 */
export async function getTeamActivityByUser(db: DrizzleDB, teamId: string, days: number) {
  const startDate = new Date();
  if (days === 1) {
    // For 24 hours, start from 24 hours ago
    startDate.setHours(startDate.getHours() - 24);
  } else {
    startDate.setDate(startDate.getDate() - days + 1);
    startDate.setHours(0, 0, 0, 0);
  }
  const startTimestamp = Math.floor(startDate.getTime() / 1000);

  // Use hour grouping for 24h, day grouping otherwise
  const periodSql =
    days === 1
      ? sql<string>`STRFTIME('%Y-%m-%d %H:00', ${transcripts.createdAt}, 'unixepoch')`
      : sql<string>`DATE(${transcripts.createdAt}, 'unixepoch')`;

  const results = await db
    .select({
      period: periodSql.as("period"),
      userId: transcripts.userId,
      userName: user.name,
      count: sql<number>`CAST(COUNT(*) AS INTEGER)`.as("count"),
    })
    .from(transcripts)
    .innerJoin(user, eq(transcripts.userId, user.id))
    .where(buildTeamVisibleConditionWithDate(teamId, startTimestamp))
    .groupBy(periodSql, transcripts.userId, user.name)
    .orderBy(periodSql);

  return results;
}

/**
 * Get per-member stats for a team with favorite model and agent.
 */
export async function getTeamMemberStats(db: DrizzleDB, teamId: string, days: number) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);
  const startTimestamp = Math.floor(startDate.getTime() / 1000);

  // Get basic member stats
  const memberStats = await db
    .select({
      ownerId: teams.ownerId,
      userId: user.id,
      userName: user.name,
      userEmail: user.email,
      userImage: user.image,
      transcriptCount: sql<number>`CAST(COUNT(${transcripts.id}) AS INTEGER)`.as("transcript_count"),
      linesAdded: sql<number>`COALESCE(SUM(${transcripts.linesAdded}), 0)`.as("lines_added"),
      linesRemoved: sql<number>`COALESCE(SUM(${transcripts.linesRemoved}), 0)`.as("lines_removed"),
      linesModified: sql<number>`COALESCE(SUM(${transcripts.linesModified}), 0)`.as("lines_modified"),
    })
    .from(teamMembers)
    .innerJoin(user, eq(teamMembers.userId, user.id))
    .innerJoin(teams, eq(teamMembers.teamId, teams.id))
    .leftJoin(
      transcripts,
      and(
        eq(transcripts.userId, user.id),
        or(
          and(eq(transcripts.visibility, "team"), eq(transcripts.sharedWithTeamId, teamId)),
          eq(transcripts.visibility, "public"),
        ),
        sql`${transcripts.createdAt} >= ${startTimestamp}`,
      ),
    )
    .where(eq(teamMembers.teamId, teamId))
    .groupBy(user.id, teams.ownerId)
    .orderBy(desc(sql`transcript_count`));

  // Get favorite model per user (most used)
  const favoriteModels = await db
    .select({
      userId: transcripts.userId,
      model: transcripts.model,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(transcripts)
    .innerJoin(teamMembers, eq(teamMembers.userId, transcripts.userId))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        or(
          and(eq(transcripts.visibility, "team"), eq(transcripts.sharedWithTeamId, teamId)),
          eq(transcripts.visibility, "public"),
        ),
        sql`${transcripts.createdAt} >= ${startTimestamp}`,
        sql`${transcripts.model} IS NOT NULL`,
      ),
    )
    .groupBy(transcripts.userId, transcripts.model)
    .orderBy(desc(sql`count`));

  // Get favorite agent per user (most used source)
  const favoriteAgents = await db
    .select({
      userId: transcripts.userId,
      agent: transcripts.source,
      count: sql<number>`COUNT(*)`.as("count"),
    })
    .from(transcripts)
    .innerJoin(teamMembers, eq(teamMembers.userId, transcripts.userId))
    .where(
      and(
        eq(teamMembers.teamId, teamId),
        or(
          and(eq(transcripts.visibility, "team"), eq(transcripts.sharedWithTeamId, teamId)),
          eq(transcripts.visibility, "public"),
        ),
        sql`${transcripts.createdAt} >= ${startTimestamp}`,
      ),
    )
    .groupBy(transcripts.userId, transcripts.source)
    .orderBy(desc(sql`count`));

  // Build maps for favorite model/agent per user (first one is most used)
  const modelMap = new Map<string, string>();
  for (const row of favoriteModels) {
    if (!modelMap.has(row.userId)) {
      modelMap.set(row.userId, row.model || "");
    }
  }

  const agentMap = new Map<string, string>();
  for (const row of favoriteAgents) {
    if (!agentMap.has(row.userId)) {
      agentMap.set(row.userId, row.agent);
    }
  }

  return memberStats.map((m) => ({
    userId: m.userId,
    userName: m.userName,
    userEmail: m.userEmail,
    userImage: m.userImage,
    isOwner: m.ownerId === m.userId,
    transcriptCount: m.transcriptCount,
    linesAdded: m.linesAdded,
    linesRemoved: m.linesRemoved,
    linesModified: m.linesModified,
    favoriteModel: modelMap.get(m.userId) || null,
    favoriteAgent: agentMap.get(m.userId) || null,
  }));
}

/**
 * Get model usage stats for a team within a date range.
 */
export async function getTeamModelUsage(db: DrizzleDB, teamId: string, days: number) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);
  const startTimestamp = Math.floor(startDate.getTime() / 1000);

  const results = await db
    .select({
      model: transcripts.model,
      count: sql<number>`CAST(COUNT(*) AS INTEGER)`.as("count"),
    })
    .from(transcripts)
    .where(and(buildTeamVisibleConditionWithDate(teamId, startTimestamp), sql`${transcripts.model} IS NOT NULL`))
    .groupBy(transcripts.model)
    .orderBy(desc(sql`count`));

  return results.map((r) => ({
    model: r.model || "unknown",
    count: r.count,
  }));
}

/**
 * Get agent (source) usage stats for a team within a date range.
 */
export async function getTeamAgentUsage(db: DrizzleDB, teamId: string, days: number) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days + 1);
  startDate.setHours(0, 0, 0, 0);
  const startTimestamp = Math.floor(startDate.getTime() / 1000);

  const results = await db
    .select({
      agent: transcripts.source,
      count: sql<number>`CAST(COUNT(*) AS INTEGER)`.as("count"),
    })
    .from(transcripts)
    .where(buildTeamVisibleConditionWithDate(teamId, startTimestamp))
    .groupBy(transcripts.source)
    .orderBy(desc(sql`count`));

  return results;
}

/**
 * Check if viewer can access a specific blob via any transcript.
 * Returns true if viewer owns any transcript referencing this blob,
 * OR if any public transcript references it,
 * OR if any team-shared transcript (with proper access) references it.
 */
export async function canAccessBlob(db: DrizzleDB, viewerId: string, blobSha256: string) {
  const result = db.$client
    .prepare(`
      SELECT 1
      FROM transcript_blobs tb
      INNER JOIN transcripts t ON tb.transcript_id = t.id
      WHERE tb.sha256 = ?
        AND (
          t.user_id = ?
          OR t.visibility = 'public'
          OR (
            t.visibility = 'team'
            AND EXISTS (
              SELECT 1
              FROM team_members viewer_tm
              WHERE viewer_tm.team_id = t.shared_with_team_id
                AND viewer_tm.user_id = ?
            )
            AND EXISTS (
              SELECT 1
              FROM team_members owner_tm
              WHERE owner_tm.team_id = t.shared_with_team_id
                AND owner_tm.user_id = t.user_id
            )
          )
        )
      LIMIT 1
    `)
    .get(blobSha256, viewerId, viewerId);

  return result !== null;
}

/**
 * Check if a blob belongs to any public transcript.
 * Used for unauthenticated access to blobs.
 */
export async function canAccessPublicBlob(db: DrizzleDB, blobSha256: string) {
  const result = db.$client
    .prepare(`
      SELECT 1
      FROM transcript_blobs tb
      INNER JOIN transcripts t ON tb.transcript_id = t.id
      WHERE tb.sha256 = ?
        AND t.visibility = 'public'
      LIMIT 1
    `)
    .get(blobSha256);

  return result !== null;
}
