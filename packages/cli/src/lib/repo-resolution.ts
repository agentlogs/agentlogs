import { getRepoIdsFromGitRoot, locateGitRoot } from "@agentlogs/shared/git";
import { createRepoAllowedChecker } from "../settings";

export interface CwdCandidate {
  cwd: string;
  /** Number of records that referenced this cwd. */
  weight: number;
}

export interface RepoCandidate {
  repoId: string;
  cwd: string;
  gitRoot: string;
  remote: string;
  weight: number;
}

export interface ResolvedUploadTarget {
  /** Repo id to attribute the upload to (null when no git repo was found). */
  repoId: string | null;
  /** Working directory to use for git-context resolution and downstream re-checks. */
  cwd: string;
  /** Whether the allowlist/denylist settings permit this upload. */
  allowed: boolean;
  /** Distinct repo ids seen across the session's directories (for messaging). */
  candidatesSeen: string[];
}

export interface CwdResolution {
  gitRoot: string;
  repos: { repoId: string; remote: string }[];
}

export interface ResolveUploadTargetDeps {
  /** Resolve a cwd to its git root + every repo id reachable from its remotes. */
  resolveCwd?: (cwd: string) => Promise<CwdResolution | null>;
  /** Allowlist predicate (defaults to settings-backed isRepoAllowed). */
  isAllowed?: (repoId: string | null) => boolean;
}

/**
 * Build a cwd resolver that memoizes by git root, so distinct cwds under the same
 * repository (e.g. /repo, /repo/src, /repo/src/lib) read .git/config only once.
 * Each resolveUploadTarget call gets a fresh resolver (no stale cross-call cache).
 */
export function createDefaultResolveCwd(): (cwd: string) => Promise<CwdResolution | null> {
  const rootByCwd = new Map<string, string | null>();
  const reposByRoot = new Map<string, { repoId: string; remote: string }[]>();

  return async (cwd: string): Promise<CwdResolution | null> => {
    let gitRoot = rootByCwd.get(cwd);
    if (gitRoot === undefined) {
      gitRoot = await locateGitRoot(cwd);
      rootByCwd.set(cwd, gitRoot);
    }
    if (!gitRoot) {
      return null;
    }
    let repos = reposByRoot.get(gitRoot);
    if (!repos) {
      repos = await getRepoIdsFromGitRoot(gitRoot);
      reposByRoot.set(gitRoot, repos);
    }
    return { gitRoot, repos };
  };
}

/**
 * Build the flat list of repo candidates across all cwds x all remotes.
 * Preserves the priority order of the input cwds (callers pass them sorted by
 * descending weight); within a cwd, remotes are origin-first.
 */
export async function buildRepoCandidates(
  cwdCandidates: CwdCandidate[],
  resolveCwd: NonNullable<ResolveUploadTargetDeps["resolveCwd"]>,
): Promise<RepoCandidate[]> {
  const candidates: RepoCandidate[] = [];
  for (const { cwd, weight } of cwdCandidates) {
    const resolved = await resolveCwd(cwd);
    if (!resolved) {
      continue;
    }
    for (const { repoId, remote } of resolved.repos) {
      candidates.push({ repoId, cwd, gitRoot: resolved.gitRoot, remote, weight });
    }
  }
  return candidates;
}

/**
 * Pure selection: the first allowed candidate in priority order. `candidates`
 * must already be ordered by descending cwd weight, origin-first within a cwd
 * (as buildRepoCandidates produces from weight-sorted cwds), so the first match
 * is the dominant allowlisted repo.
 */
export function selectBestAllowedRepo(
  candidates: RepoCandidate[],
  isAllowed: (repoId: string) => boolean,
): RepoCandidate | null {
  return candidates.find((candidate) => isAllowed(candidate.repoId)) ?? null;
}

/**
 * Decide which repo an upload should be attributed to, and whether it is allowed.
 *
 * Considers every working directory the session touched and every remote of each
 * (not just the first cwd's `origin`). This is what lets a session launched from
 * a home/personal directory — that pushed/PR'd to an allowlisted repo, possibly
 * via an `upstream` remote on a fork — be attributed and uploaded instead of
 * silently skipped.
 *
 * Behavior preserved for the common cases:
 * - First cwd already resolves to an allowed repo -> same repo selected.
 * - No git repo found anywhere -> "unknown repo" handling (denylist uploads,
 *   allowlist skips), exactly as `isRepoAllowed(null)` decides today.
 * - Repos found but all explicitly denied / not allowlisted -> skip.
 *
 * Deny wins in denylist mode: if the session touched ANY explicitly denied repo,
 * the upload is skipped even if it also touched an allowed repo. A transcript
 * carries every record's content regardless of which repo it is attributed to,
 * so a denied repo's content must never ride along under an allowed attribution.
 */
export async function resolveUploadTarget(
  cwdCandidates: CwdCandidate[],
  defaultCwd: string,
  deps: ResolveUploadTargetDeps = {},
): Promise<ResolvedUploadTarget> {
  const resolveCwd = deps.resolveCwd ?? createDefaultResolveCwd();
  const isAllowed = deps.isAllowed ?? createRepoAllowedChecker();

  const candidates = await buildRepoCandidates(cwdCandidates, resolveCwd);
  const candidatesSeen = [...new Set(candidates.map((candidate) => candidate.repoId))];

  // Deny wins: in denylist mode, an explicitly denied repo among the candidates
  // (isAllowed === false while unknown repos are allowed) forces a skip.
  const denylistMode = isAllowed(null);
  if (denylistMode) {
    const denied = candidates.find((candidate) => !isAllowed(candidate.repoId));
    if (denied) {
      return { repoId: denied.repoId, cwd: denied.cwd, allowed: false, candidatesSeen };
    }
  }

  const best = selectBestAllowedRepo(candidates, (repoId) => isAllowed(repoId));
  if (best) {
    return { repoId: best.repoId, cwd: best.cwd, allowed: true, candidatesSeen };
  }

  if (candidates.length === 0) {
    // No git repo found in any directory -> unknown-repo handling.
    return { repoId: null, cwd: defaultCwd, allowed: isAllowed(null), candidatesSeen };
  }

  // Repos were found but none are allowed (explicitly denied, or not allowlisted).
  const dominant = candidates[0];
  return { repoId: dominant.repoId, cwd: dominant.cwd, allowed: false, candidatesSeen };
}
