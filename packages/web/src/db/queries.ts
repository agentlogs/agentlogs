import { and, count, desc, eq, exists, isNull, lt, or, sql } from "drizzle-orm";
import type { DrizzleDB } from ".";
import { repos, teamInvites, teamMembers, teams, transcripts, user, type UserRole } from "./schema";

/**
 * Get all repos for a user with computed transcript count
 */
export async function getRepos(db: DrizzleDB, userId: string) {
  return await db
    .select({
      id: repos.id,
      repo: repos.repo,
      lastActivity: repos.lastActivity,
      createdAt: repos.createdAt,
      transcriptCount: sql<number>`CAST(COUNT(${transcripts.id}) AS INTEGER)`.as("transcript_count"),
    })
    .from(repos)
    .leftJoin(transcripts, and(eq(transcripts.repoId, repos.id), eq(transcripts.userId, userId)))
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
  const { cursor, limit } = params;

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
      email: user.email,
      image: user.image,
      role: user.role,
      createdAt: user.createdAt,
      transcriptCount: sql<number>`CAST(COUNT(${transcripts.id}) AS INTEGER)`.as("transcript_count"),
      totalCost: sql<number>`COALESCE(SUM(${transcripts.costUsd}), 0)`.as("total_cost"),
    })
    .from(user)
    .leftJoin(transcripts, eq(transcripts.userId, user.id))
    .groupBy(user.id)
    .orderBy(desc(user.createdAt));
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
 * 2. Public transcripts visible to everyone
 * 3. Team transcripts visible if:
 *    - Viewer is in the sharedWithTeamId team AND
 *    - Owner is ALSO still in that team (prevents stale sharing after owner leaves)
 */
function buildVisibilityCondition(viewerId: string) {
  return or(
    // 1. Owner sees own transcripts
    eq(transcripts.userId, viewerId),
    // 2. Public transcripts
    eq(transcripts.visibility, "public"),
    // 3. Team transcripts where viewer AND owner are both in the shared team
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
      userName: user.name,
      userImage: user.image,
      repoName: repos.repo,
    })
    .from(transcripts)
    .leftJoin(user, eq(transcripts.userId, user.id))
    .leftJoin(repos, eq(transcripts.repoId, repos.id))
    .where(and(eq(transcripts.id, id), buildVisibilityCondition(viewerId)))
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
 * Check if viewer can access a specific blob via any transcript.
 * Returns true if viewer owns any transcript referencing this blob,
 * OR if any public transcript references it,
 * OR if any team-shared transcript (with proper access) references it.
 */
export async function canAccessBlob(db: DrizzleDB, viewerId: string, blobSha256: string) {
  // Use raw D1 client for complex EXISTS query
  const result = await db.$client
    .prepare(`
    SELECT 1 FROM transcript_blobs tb
    INNER JOIN transcripts t ON tb.transcript_id = t.id
    WHERE tb.sha256 = ?
    AND (
      t.user_id = ?
      OR t.visibility = 'public'
      OR (
        t.visibility = 'team'
        AND EXISTS (
          SELECT 1 FROM team_members viewer_tm
          WHERE viewer_tm.team_id = t.shared_with_team_id
          AND viewer_tm.user_id = ?
        )
        AND EXISTS (
          SELECT 1 FROM team_members owner_tm
          WHERE owner_tm.team_id = t.shared_with_team_id
          AND owner_tm.user_id = t.user_id
        )
      )
    )
    LIMIT 1
  `)
    .bind(blobSha256, viewerId, viewerId)
    .first();

  return result !== null;
}
