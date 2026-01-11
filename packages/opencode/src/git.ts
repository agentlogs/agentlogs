import path from "node:path";
import type { UnifiedGitContext } from "@vibeinsights/shared";

/**
 * Plugin context interface (subset of what OpenCode provides)
 */
export interface PluginContext {
  directory: string;
  worktree?: string;
  $: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<{ stdout: string; exitCode: number }>;
}

/**
 * Extract git context from the plugin context using Bun shell.
 */
export async function extractGitContext(ctx: PluginContext): Promise<UnifiedGitContext> {
  const worktree = ctx.worktree ?? ctx.directory;

  if (!worktree) {
    return { repo: null, branch: null, relativeCwd: null };
  }

  try {
    // Get current branch
    const branchResult = await ctx.$`git -C ${worktree} rev-parse --abbrev-ref HEAD 2>/dev/null`;
    const branch = branchResult.exitCode === 0 ? branchResult.stdout.trim() : null;

    // Get remote URL
    const remoteResult = await ctx.$`git -C ${worktree} config --get remote.origin.url 2>/dev/null`;
    const remoteUrl = remoteResult.exitCode === 0 ? remoteResult.stdout.trim() : null;

    // Parse remote URL to get repo identifier
    const repo = remoteUrl ? parseRemoteUrl(remoteUrl) : null;

    // Calculate relative cwd
    const relativeCwd = ctx.directory !== worktree ? path.relative(worktree, ctx.directory) : null;

    return {
      repo,
      branch,
      relativeCwd: relativeCwd || null,
    };
  } catch {
    return { repo: null, branch: null, relativeCwd: null };
  }
}

/**
 * Parse git remote URL to extract repository identifier.
 * Handles both SSH and HTTPS formats.
 */
function parseRemoteUrl(remoteUrl: string): string | null {
  if (!remoteUrl) return null;

  // SSH format: git@github.com:owner/repo.git
  const sshMatch = remoteUrl.match(/^(?:[^@]+)@([^:]+):(.+?)(?:\.git)?$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2].replace(/\.git$/, "")}`;
  }

  // HTTPS format: https://github.com/owner/repo.git
  const httpsMatch = remoteUrl.match(/https?:\/\/([^/]+)\/(.+?)(?:\.git)?$/);
  if (httpsMatch) {
    return `${httpsMatch[1]}/${httpsMatch[2].replace(/\.git$/, "")}`;
  }

  return null;
}

/**
 * Check if a shell command is a git commit.
 */
export function isGitCommitCommand(input: unknown): boolean {
  if (!input || typeof input !== "object") return false;

  const record = input as Record<string, unknown>;

  // Handle command as array (OpenCode shell format)
  if (Array.isArray(record.command)) {
    const cmdString = record.command.join(" ");
    return /\bgit\s+commit\b/.test(cmdString);
  }

  // Handle command as string
  if (typeof record.command === "string") {
    return /\bgit\s+commit\b/.test(record.command);
  }

  return false;
}

/**
 * Extract the commit message from git commit args.
 */
export function extractCommitMessage(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;

  const record = input as Record<string, unknown>;
  let cmdString: string;

  if (Array.isArray(record.command)) {
    cmdString = record.command.join(" ");
  } else if (typeof record.command === "string") {
    cmdString = record.command;
  } else {
    return null;
  }

  // Match -m "message" or -m 'message' or -m message
  const messageMatch = cmdString.match(/-m\s+(?:"([^"]+)"|'([^']+)'|(\S+))/);
  if (messageMatch) {
    return messageMatch[1] || messageMatch[2] || messageMatch[3] || null;
  }

  return null;
}

/**
 * Modify git commit command to append transcript link to message.
 */
export function appendTranscriptLinkToCommit(
  input: unknown,
  transcriptUrl: string,
): Record<string, unknown> | null {
  if (!input || typeof input !== "object") return null;

  const record = { ...(input as Record<string, unknown>) };
  const existingMessage = extractCommitMessage(input);

  if (!existingMessage) return null;

  const newMessage = `${existingMessage}\n\nTranscript: ${transcriptUrl}`;

  if (Array.isArray(record.command)) {
    // Replace the message in the command array
    const cmdArray = [...(record.command as string[])];
    for (let i = 0; i < cmdArray.length; i++) {
      if (cmdArray[i] === "-m" && i + 1 < cmdArray.length) {
        cmdArray[i + 1] = newMessage;
        break;
      }
    }
    record.command = cmdArray;
  } else if (typeof record.command === "string") {
    // Replace in command string
    record.command = (record.command as string).replace(
      /-m\s+(?:"[^"]+"|'[^']+'|\S+)/,
      `-m "${newMessage.replace(/"/g, '\\"')}"`,
    );
  }

  return record;
}
