import * as fs from "fs/promises";
import * as path from "path";

/**
 * Parse a git remote URL to extract host and repo path.
 * Supports SSH (git@host:owner/repo.git) and HTTPS (https://host/owner/repo.git) formats.
 * Returns format: "host/owner/repo" (e.g., "github.com/owner/repo")
 */
export function parseGitRemoteUrl(url: string): string | null {
  // SSH format: git@github.com:owner/repo.git
  const sshMatch = url.match(/git@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  // HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = url.match(/https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2]}`;
  }

  return null;
}

/**
 * Locate the git root directory by walking up from the start directory.
 * Returns the path to the git root, or null if not found.
 */
export async function locateGitRoot(start: string): Promise<string | null> {
  let current = path.resolve(start);
  const { root } = path.parse(current);

  while (true) {
    const gitDir = path.join(current, ".git");
    try {
      const stats = await fs.stat(gitDir);
      if (stats.isDirectory() || stats.isFile()) {
        return current;
      }
    } catch {
      // continue
    }

    if (current === root) {
      return null;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export interface GitRemote {
  name: string;
  url: string;
}

/**
 * Read every remote (name + url) from .git/config.
 * Remotes are returned with "origin" first (when present), then in file order.
 */
export async function readGitRemotes(repoRoot: string): Promise<GitRemote[]> {
  try {
    const configPath = path.join(repoRoot, ".git", "config");
    const configContent = await fs.readFile(configPath, "utf8");

    const remotes: GitRemote[] = [];
    let currentRemote: string | null = null;

    for (const rawLine of configContent.split(/\r?\n/)) {
      const line = rawLine.trim();

      const sectionMatch = line.match(/^\[remote "([^"]+)"\]/i);
      if (sectionMatch && sectionMatch[1]) {
        currentRemote = sectionMatch[1];
        continue;
      }
      // Any other section header ends the current remote section.
      if (line.startsWith("[")) {
        currentRemote = null;
        continue;
      }

      if (currentRemote) {
        const urlMatch = line.match(/^url\s*=\s*(.+)$/i);
        if (urlMatch && urlMatch[1]) {
          remotes.push({ name: currentRemote, url: urlMatch[1].trim() });
          currentRemote = null;
        }
      }
    }

    // Stable order: origin first, everything else in file order.
    return remotes.sort((a, b) => (a.name === "origin" ? -1 : 0) - (b.name === "origin" ? -1 : 0));
  } catch {
    return [];
  }
}

/**
 * Read the origin remote URL from .git/config.
 * Origin-only by design: returns null when there is no `origin` remote, matching
 * the historical contract. Multi-remote resolution lives in getRepoIdsFromGitRoot.
 */
export async function readGitRemoteUrl(repoRoot: string): Promise<string | null> {
  const remotes = await readGitRemotes(repoRoot);
  return remotes.find((remote) => remote.name === "origin")?.url ?? null;
}

/**
 * Get the repo ID from a git root directory (origin remote).
 * Returns format: "host/owner/repo" (e.g., "github.com/owner/repo")
 */
export async function getRepoIdFromGitRoot(repoRoot: string): Promise<string | null> {
  const url = await readGitRemoteUrl(repoRoot);
  if (!url) {
    return null;
  }
  return parseGitRemoteUrl(url);
}

export interface RepoRemoteId {
  repoId: string;
  remote: string;
}

/**
 * Get every repo ID reachable from a git root's remotes (not just origin).
 * Useful for fork workflows where `origin` is a personal fork but `upstream`
 * (or another remote) points at the canonical repo. Returns origin-first,
 * de-duplicated by repoId.
 */
export async function getRepoIdsFromGitRoot(repoRoot: string): Promise<RepoRemoteId[]> {
  const remotes = await readGitRemotes(repoRoot);
  const seen = new Set<string>();
  const result: RepoRemoteId[] = [];
  for (const remote of remotes) {
    const repoId = parseGitRemoteUrl(remote.url);
    if (repoId && !seen.has(repoId)) {
      seen.add(repoId);
      result.push({ repoId, remote: remote.name });
    }
  }
  return result;
}

/**
 * Get the repo ID from a working directory by locating git root and reading remote.
 * Returns format: "host/owner/repo" (e.g., "github.com/owner/repo")
 */
export async function getRepoId(cwd?: string): Promise<string | null> {
  const targetDir = cwd ?? process.cwd();

  const repoRoot = await locateGitRoot(targetDir);
  if (!repoRoot) {
    return null;
  }

  return getRepoIdFromGitRoot(repoRoot);
}

/**
 * Read the current branch from .git/HEAD
 */
export async function readGitBranch(repoRoot: string, fallback?: string): Promise<string | null> {
  try {
    const headPath = path.join(repoRoot, ".git", "HEAD");
    const headContent = await fs.readFile(headPath, "utf8");
    const trimmed = headContent.trim();
    if (trimmed.startsWith("ref:")) {
      const ref = trimmed.slice(4).trim();
      const parts = ref.split("/");
      return parts[parts.length - 1] ?? fallback ?? null;
    }
    return trimmed || fallback || null;
  } catch {
    return fallback ?? null;
  }
}
