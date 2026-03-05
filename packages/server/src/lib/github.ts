import { logger } from "./logger";

/**
 * Check if a GitHub repo is public via unauthenticated API call.
 *
 * @param repoFullName - Full repo name, e.g., "facebook/react" or "github.com/facebook/react"
 * @returns true if public, false if private/not found, null if API error (use cached fallback)
 */
export async function checkRepoIsPublic(repoFullName: string): Promise<boolean | null> {
  // Extract owner/repo from full name or path
  // Handles: "facebook/react", "github.com/facebook/react", "/users/foo/repos/owner/repo"
  const match = repoFullName.match(/([^/]+\/[^/]+)$/);
  if (!match) {
    logger.warn("Could not parse repo name", { repoFullName });
    return null;
  }

  const ownerRepo = match[1];

  try {
    const response = await fetch(`https://api.github.com/repos/${ownerRepo}`, {
      headers: { "User-Agent": "AgentLogs/1.0" },
    });

    if (response.status === 200) {
      const data = (await response.json()) as { private?: boolean };
      return !data.private; // public if not private
    }

    if (response.status === 404) {
      return false; // private or doesn't exist
    }

    // Rate limited or other error
    logger.warn("GitHub API unexpected status", { status: response.status, repo: ownerRepo });
    return null;
  } catch (error) {
    logger.error("GitHub API error", { error, repo: ownerRepo });
    return null;
  }
}
