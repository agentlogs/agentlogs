/**
 * Claude Code Hook Command
 *
 * Handles PreToolUse, PostToolUse, SessionEnd, and Stop events from Claude Code.
 * Reads JSON from stdin, processes the event, and outputs JSON response.
 */

import { performUploadToAllEnvs } from "../../lib/perform-upload";
import { getRepoIdFromCwd, isRepoAllowed, shouldAddTranscriptLinkToCommit } from "../../settings";
import {
  hookLogger as logger,
  containsGitCommit,
  appendTranscriptLink,
  extractTranscriptIdFromOutput,
  parseCommitShaFromOutput,
  parseCommitTitleFromOutput,
  parseBranchFromOutput,
  trackCommit,
  readStdinWithPreview,
  getOrCreateTranscriptId,
  getPreferredTranscriptBaseUrl,
} from "../../lib/hooks-shared";

interface ClaudeHookInput {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  reason?: string;
  stop_hook_active?: boolean;
  tool_name?: string;
  tool?: string;
  tool_input?: {
    command?: string;
    [key: string]: unknown;
  };
  tool_response?: {
    stdout?: string;
    stderr?: string;
    [key: string]: unknown;
  };
  command?: string;
  repo_path?: string;
  [key: string]: unknown;
}

export async function hookCommand(): Promise<void> {
  const startTime = Date.now();
  let eventName: string | undefined;
  let sessionId: string | undefined;

  try {
    const { preview, full } = await readStdinWithPreview();

    logger.info(`Hook invoked (stdin: ${full.length} bytes)`);

    if (!full.trim()) {
      logger.warn("Hook received empty stdin - ignoring");
      process.exit(0);
    }

    // Quick check: for PreToolUse, skip parsing large payloads that aren't git commits
    const isPreToolUse = preview.includes('"PreToolUse"');
    const mightBeGitCommit = preview.includes("git") && preview.includes("commit");
    if (isPreToolUse && !mightBeGitCommit) {
      const output = {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      };
      process.stdout.write(JSON.stringify(output));
      const duration = Date.now() - startTime;
      logger.info(`Hook completed: PreToolUse (fast path, ${duration}ms)`);
      process.exit(0);
    }

    let hookInput: ClaudeHookInput;
    try {
      hookInput = JSON.parse(full) as ClaudeHookInput;
    } catch (error) {
      logger.error("Hook failed to parse stdin JSON", { error: error instanceof Error ? error.message : error });
      process.exit(1);
    }

    eventName = hookInput.hook_event_name;
    sessionId = hookInput.session_id || "unknown";

    if (!eventName) {
      logger.error("Hook missing event name", { sessionId });
      process.exit(1);
    }

    logger.info(`Hook: ${eventName} (session: ${sessionId.substring(0, 8)}...)`);

    if (eventName === "PreToolUse") {
      await handlePreToolUse(hookInput);
    } else if (eventName === "PostToolUse") {
      await handlePostToolUse(hookInput);
    } else if (eventName === "SessionEnd") {
      await handleSessionEnd(hookInput);
    } else if (eventName === "Stop") {
      await handleStop(hookInput);
    } else {
      logger.debug(`Hook: skipping unsupported event ${eventName}`);
    }

    const duration = Date.now() - startTime;
    logger.info(`Hook completed: ${eventName} (${duration}ms)`, { sessionId: sessionId.substring(0, 8) });
    process.exit(0);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Hook failed: ${eventName || "unknown"} (${duration}ms)`, {
      sessionId: sessionId?.substring(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

function extractCommand(hookInput: ClaudeHookInput): {
  command: string | undefined;
  updateCommand: (nextCommand: string) => void;
} {
  if (
    hookInput.tool_input &&
    typeof hookInput.tool_input === "object" &&
    typeof hookInput.tool_input.command === "string"
  ) {
    return {
      command: hookInput.tool_input.command,
      updateCommand: (nextCommand: string) => {
        if (hookInput.tool_input) {
          hookInput.tool_input.command = nextCommand;
        }
      },
    };
  }

  if (typeof hookInput.command === "string") {
    return {
      command: hookInput.command,
      updateCommand: (nextCommand: string) => {
        hookInput.command = nextCommand;
      },
    };
  }

  return {
    command: undefined,
    updateCommand: () => {},
  };
}

function getToolOutput(hookInput: ClaudeHookInput): string | undefined {
  if (hookInput.tool_response?.stdout) {
    return hookInput.tool_response.stdout;
  }
  if (hookInput.tool_response) {
    return JSON.stringify(hookInput.tool_response);
  }
  return undefined;
}

function getRepoPath(hookInput: ClaudeHookInput): string {
  if (typeof hookInput.repo_path === "string") {
    return hookInput.repo_path;
  }
  if (typeof hookInput.cwd === "string") {
    return hookInput.cwd;
  }
  return "";
}

async function handlePreToolUse(hookInput: ClaudeHookInput): Promise<void> {
  const sessionId = hookInput.session_id || "unknown";
  let shouldTrack = false;
  let modified = false;

  const { command, updateCommand } = extractCommand(hookInput);
  const toolName = typeof hookInput.tool_name === "string" ? hookInput.tool_name : hookInput.tool;
  const isBashTool = toolName ? toolName.toLowerCase() === "bash" : Boolean(command);

  const cwd = typeof hookInput.cwd === "string" ? hookInput.cwd : undefined;
  const repoId = await getRepoIdFromCwd(cwd);
  const repoAllowed = isRepoAllowed(repoId);

  if (isBashTool && command && containsGitCommit(command) && repoAllowed && shouldAddTranscriptLinkToCommit(repoId)) {
    shouldTrack = true;
    const clientId = await getOrCreateTranscriptId(sessionId);
    const transcriptBaseUrl = await getPreferredTranscriptBaseUrl();
    const updatedCommand = appendTranscriptLink(command, clientId, transcriptBaseUrl);
    if (updatedCommand !== command) {
      updateCommand(updatedCommand);
      modified = true;
    }
  }

  const output = modified
    ? {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
          updatedInput: hookInput.tool_input,
        },
      }
    : {
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "allow",
        },
      };
  process.stdout.write(JSON.stringify(output));

  if (shouldTrack) {
    await uploadPartialTranscript({
      sessionId,
      transcriptPath: hookInput.transcript_path,
      cwd: typeof hookInput.cwd === "string" ? hookInput.cwd : undefined,
    });
  }

  logger.info("PreToolUse handled", {
    sessionId: sessionId.substring(0, 8),
    shouldTrack,
    modified,
  });
}

async function handlePostToolUse(hookInput: ClaudeHookInput): Promise<void> {
  const sessionId = hookInput.session_id || "unknown";
  const repoPath = getRepoPath(hookInput);

  const { command } = extractCommand(hookInput);
  if (!command || !containsGitCommit(command)) {
    return;
  }

  const transcriptId = extractTranscriptIdFromOutput(command);
  if (!transcriptId) {
    logger.debug("PostToolUse: git commit without agentlogs link", { sessionId: sessionId.substring(0, 8) });
    return;
  }

  const toolOutput = getToolOutput(hookInput);
  const commitSha = toolOutput ? parseCommitShaFromOutput(toolOutput) : undefined;
  const commitTitle = toolOutput ? parseCommitTitleFromOutput(toolOutput) : undefined;
  const branch = toolOutput ? parseBranchFromOutput(toolOutput) : undefined;

  await trackCommit({
    transcriptId,
    repoPath,
    timestamp: new Date().toISOString(),
    commitSha,
    commitTitle,
    branch,
  });

  logger.info("PostToolUse: tracked commit", {
    sessionId: sessionId.substring(0, 8),
    transcriptId,
    commitSha: commitSha?.substring(0, 8),
  });
}

async function handleSessionEnd(hookInput: ClaudeHookInput): Promise<void> {
  const transcriptPath = hookInput.transcript_path;
  const sessionId = hookInput.session_id || "unknown";

  if (!transcriptPath) {
    logger.error("SessionEnd: missing transcript_path", { sessionId });
    return;
  }

  try {
    const result = await performUploadToAllEnvs({
      transcriptPath,
      sessionId: hookInput.session_id,
      cwdOverride: hookInput.cwd,
    });

    if (result.results.length === 0) {
      if (!result.anySuccess) {
        logger.info(`SessionEnd: upload skipped (repo not allowed or no auth)`, { sessionId });
      }
      return;
    }

    for (const envResult of result.results) {
      if (envResult.success) {
        logger.info(`SessionEnd: uploaded to ${envResult.envName} (${result.eventCount} events)`, {
          transcriptId: envResult.transcriptId,
          sessionId: sessionId.substring(0, 8),
        });
      } else {
        logger.error(`SessionEnd: upload to ${envResult.envName} failed`, {
          sessionId,
          error: envResult.error,
        });
      }
    }
  } catch (error) {
    logger.error("SessionEnd: upload error", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleStop(hookInput: ClaudeHookInput): Promise<void> {
  const transcriptPath = hookInput.transcript_path;
  const sessionId = hookInput.session_id || "unknown";

  if (!transcriptPath) {
    logger.error("Stop: missing transcript_path", { sessionId });
    return;
  }

  if (hookInput.stop_hook_active) {
    logger.debug("Stop: skipped (stop_hook_active=true)", { sessionId });
    return;
  }

  try {
    const result = await performUploadToAllEnvs({
      transcriptPath,
      sessionId: hookInput.session_id,
      cwdOverride: hookInput.cwd,
    });

    if (result.results.length === 0) {
      if (!result.anySuccess) {
        logger.info(`Stop: upload skipped (repo not allowed or no auth)`, { sessionId });
      }
      return;
    }

    for (const envResult of result.results) {
      if (envResult.success) {
        logger.info(`Stop: uploaded to ${envResult.envName} (${result.eventCount} events)`, {
          transcriptId: envResult.transcriptId,
          sessionId: sessionId.substring(0, 8),
        });
      } else {
        logger.error(`Stop: upload to ${envResult.envName} failed`, {
          sessionId,
          error: envResult.error,
        });
      }
    }
  } catch (error) {
    logger.error("Stop: upload error", {
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function uploadPartialTranscript(payload: {
  sessionId: string;
  transcriptPath?: string;
  cwd?: string;
}): Promise<void> {
  if (!payload.transcriptPath) {
    logger.warn("Partial upload skipped: missing transcript_path", {
      sessionId: payload.sessionId.substring(0, 8),
    });
    return;
  }

  try {
    const result = await performUploadToAllEnvs({
      transcriptPath: payload.transcriptPath,
      sessionId: payload.sessionId,
      cwdOverride: payload.cwd,
    });

    if (result.results.length === 0) {
      if (!result.anySuccess) {
        logger.info(`Partial upload: skipped (repo not allowed or no auth)`, {
          sessionId: payload.sessionId.substring(0, 8),
        });
      }
      return;
    }

    for (const envResult of result.results) {
      if (envResult.success) {
        logger.info(`Partial upload: uploaded to ${envResult.envName}`, {
          transcriptId: envResult.transcriptId,
          sessionId: payload.sessionId.substring(0, 8),
          eventCount: result.eventCount,
        });
      } else {
        logger.error(`Partial upload: to ${envResult.envName} failed`, {
          sessionId: payload.sessionId.substring(0, 8),
          error: envResult.error,
        });
      }
    }
  } catch (error) {
    logger.error("Partial upload: error", {
      sessionId: payload.sessionId.substring(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
