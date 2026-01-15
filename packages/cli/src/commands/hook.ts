import { createLogger } from "@agentlogs/shared/logger";
import { getDevLogPath } from "@agentlogs/shared/paths";
import { createRpcClient } from "@agentlogs/shared";
import { getAuthenticatedEnvironments } from "../config";
import { performUploadToAllEnvs } from "../lib/perform-upload";

// Create logger for CLI hook commands
// Uses shared getDevLogPath() which finds the monorepo root by looking for package.json with workspaces
const logPath = getDevLogPath();
const logger = createLogger("cli", { logFilePath: logPath, logToFile: true, disableConsole: true });

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
  command?: string;
  repo_path?: string;
  [key: string]: unknown;
}

export async function hookCommand(): Promise<void> {
  const startTime = Date.now();
  let eventName: string | undefined;
  let sessionId: string | undefined;

  try {
    // Read stdin with a preview for quick filtering
    const { preview, full } = await readStdinWithPreview();

    // Log hook invocation with stdin size
    logger.info(`Hook invoked (stdin: ${full.length} bytes)`);

    // Guard: empty stdin
    if (!full.trim()) {
      logger.warn("Hook received empty stdin - ignoring");
      process.exit(0);
    }

    // Quick check: for PreToolUse, skip parsing large payloads that aren't git commits
    // This avoids parsing 800KB+ tool inputs (e.g., Write with large file content)
    const isPreToolUse = preview.includes('"PreToolUse"');
    const mightBeGitCommit = preview.includes("git") && preview.includes("commit");
    if (isPreToolUse && !mightBeGitCommit) {
      // Fast path: not a git commit, just allow it without full parsing
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

    // Parse JSON
    let hookInput: ClaudeHookInput;
    try {
      hookInput = JSON.parse(full) as ClaudeHookInput;
    } catch (error) {
      logger.error("Hook failed to parse stdin JSON", { error: error instanceof Error ? error.message : error });
      process.exit(1);
    }

    eventName = hookInput.hook_event_name;
    sessionId = hookInput.session_id || "unknown";

    // Guard: missing event name
    if (!eventName) {
      logger.error("Hook missing event name", { sessionId });
      process.exit(1);
    }

    // Log event details
    logger.info(`Hook: ${eventName} (session: ${sessionId.substring(0, 8)}...)`);

    // Process event
    if (eventName === "PreToolUse") {
      await handlePreToolUse(hookInput);
    } else if (eventName === "SessionEnd") {
      await handleSessionEnd(hookInput);
    } else if (eventName === "Stop") {
      await handleStop(hookInput);
    } else {
      logger.debug(`Hook: skipping unsupported event ${eventName}`);
    }

    // Log successful completion
    const duration = Date.now() - startTime;
    logger.info(`Hook completed: ${eventName} (${duration}ms)`, { sessionId: sessionId.substring(0, 8) });
    process.exit(0);
  } catch (error) {
    // Log error and exit with failure code
    const duration = Date.now() - startTime;
    logger.error(`Hook failed: ${eventName || "unknown"} (${duration}ms)`, {
      sessionId: sessionId?.substring(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

async function handlePreToolUse(hookInput: ClaudeHookInput): Promise<void> {
  const sessionId = hookInput.session_id || "unknown";
  let shouldTrack = false;
  let modified = false;

  const { command, updateCommand } = extractCommand(hookInput);
  const toolName = typeof hookInput.tool_name === "string" ? hookInput.tool_name : hookInput.tool;
  const isBashTool = toolName ? toolName.toLowerCase() === "bash" : Boolean(command);

  if (isBashTool && command && containsGitCommit(command)) {
    shouldTrack = true;
    const updatedCommand = appendTranscriptLink(command, sessionId);
    if (updatedCommand !== command) {
      updateCommand(updatedCommand);
      modified = true;
    }
  }

  // Output the proper Claude Code hook response format
  // See: https://code.claude.com/docs/en/hooks (Advanced: JSON Output)
  // Must use hookSpecificOutput wrapper with permissionDecision (not decision)
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
    await trackCommit({
      sessionId,
      repoPath: getRepoPath(hookInput),
      timestamp: new Date().toISOString(),
    });
  }

  logger.info("PreToolUse handled", {
    sessionId: sessionId.substring(0, 8),
    shouldTrack,
    modified,
  });
}

async function handleSessionEnd(hookInput: ClaudeHookInput): Promise<void> {
  const transcriptPath = hookInput.transcript_path;
  const sessionId = hookInput.session_id || "unknown";

  if (!transcriptPath) {
    logger.error("SessionEnd: missing transcript_path", { sessionId });
    return;
  }

  const authenticatedEnvs = getAuthenticatedEnvironments();
  if (authenticatedEnvs.length === 0) {
    logger.error("SessionEnd: no authenticated environments found. Run the CLI login flow first.", { sessionId });
    return;
  }

  try {
    const result = await performUploadToAllEnvs({
      transcriptPath,
      sessionId: hookInput.session_id,
      cwdOverride: hookInput.cwd,
    });

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

  // Skip if stop_hook_active is true to avoid infinite loops
  if (hookInput.stop_hook_active) {
    logger.debug("Stop: skipped (stop_hook_active=true)", { sessionId });
    return;
  }

  const authenticatedEnvs = getAuthenticatedEnvironments();
  if (authenticatedEnvs.length === 0) {
    logger.error("Stop: no authenticated environments found. Run the CLI login flow first.", { sessionId });
    return;
  }

  try {
    const result = await performUploadToAllEnvs({
      transcriptPath,
      sessionId: hookInput.session_id,
      cwdOverride: hookInput.cwd,
    });

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

const STDIN_PREVIEW_SIZE = 2048;

function readStdinWithPreview(): Promise<{ preview: string; full: string }> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => {
      resolve({
        preview: data.slice(0, STDIN_PREVIEW_SIZE),
        full: data,
      });
    });
    process.stdin.on("error", (error) => reject(error));
  });
}

// --- PreToolUse helper functions ---

export function extractCommand(hookInput: ClaudeHookInput): {
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

export function containsGitCommit(command: string): boolean {
  return /\bgit\s+commit\b/.test(command);
}

export function appendTranscriptLink(command: string, sessionId: string): string {
  const linkText = `🔮 View transcript: https://agentlogs.ai/s/${sessionId}`;

  if (command.includes(linkText)) {
    return command;
  }

  const suffix = `\n\n${linkText}`;

  // Patterns for different git commit message formats
  // Order matters: check equals-sign form first, then space-separated
  // Only match the FIRST occurrence to handle multiple -m flags
  const patterns = [
    // --message="msg" or --message='msg' (equals sign form)
    { regex: /(\s--message=)"([^"]*)"/, quote: '"', equalsForm: true },
    { regex: /(\s--message=)'([^']*)'/, quote: "'", equalsForm: true },
    // -m "msg", --message "msg", -am "msg" (space-separated form)
    { regex: /(\s(?:-m|--message|-am))\s+"([^"]*)"/, quote: '"', equalsForm: false },
    { regex: /(\s(?:-m|--message|-am))\s+'([^']*)'/, quote: "'", equalsForm: false },
  ];

  for (const { regex, quote, equalsForm } of patterns) {
    const match = command.match(regex);
    if (match) {
      const flag = match[1];
      const message = match[2];
      // Only replace the first match (handles multiple -m flags)
      if (equalsForm) {
        return command.replace(regex, `${flag}${quote}${message}${suffix}${quote}`);
      }
      return command.replace(regex, `${flag} ${quote}${message}${suffix}${quote}`);
    }
  }

  return command;
}

export function getRepoPath(hookInput: ClaudeHookInput): string {
  if (typeof hookInput.repo_path === "string") {
    return hookInput.repo_path;
  }

  if (typeof hookInput.cwd === "string") {
    return hookInput.cwd;
  }

  return "";
}

async function trackCommit(payload: { sessionId: string; repoPath: string; timestamp: string }): Promise<void> {
  const authenticatedEnvs = getAuthenticatedEnvironments();
  if (authenticatedEnvs.length === 0) {
    logger.warn("Commit tracking skipped: no authenticated environments. Run 'agentlogs login' first.", {
      sessionId: payload.sessionId.substring(0, 8),
    });
    return;
  }

  // Track commit in all authenticated environments
  for (const env of authenticatedEnvs) {
    try {
      const client = createRpcClient({
        serverUrl: env.baseURL,
        authToken: env.token,
        timeoutMs: 5000,
      });

      await client.commitTrack.create({
        sessionId: payload.sessionId,
        repoPath: payload.repoPath,
        timestamp: payload.timestamp,
      });

      logger.info(`Commit tracking recorded (${env.name})`, {
        sessionId: payload.sessionId.substring(0, 8),
        repoPath: payload.repoPath,
      });
    } catch (error) {
      // Check if it was a timeout (AbortError)
      if (error instanceof Error && error.name === "AbortError") {
        logger.warn(`Commit tracking request to ${env.name} timed out after 5s`, {
          sessionId: payload.sessionId.substring(0, 8),
        });
        continue;
      }
      logger.error(`Commit tracking request to ${env.name} error`, {
        sessionId: payload.sessionId.substring(0, 8),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function uploadPartialTranscript(payload: {
  sessionId: string;
  transcriptPath?: string;
  cwd?: string;
}): Promise<void> {
  if (!payload.transcriptPath) {
    logger.warn("Commit tracking transcript upload skipped: missing transcript_path", {
      sessionId: payload.sessionId.substring(0, 8),
    });
    return;
  }

  const authenticatedEnvs = getAuthenticatedEnvironments();
  if (authenticatedEnvs.length === 0) {
    logger.warn(
      "Commit tracking transcript upload skipped: no authenticated environments. Run 'agentlogs login' first.",
      {
        sessionId: payload.sessionId.substring(0, 8),
      },
    );
    return;
  }

  try {
    const result = await performUploadToAllEnvs({
      transcriptPath: payload.transcriptPath,
      sessionId: payload.sessionId,
      cwdOverride: payload.cwd,
    });

    for (const envResult of result.results) {
      if (envResult.success) {
        logger.info(`Commit tracking: uploaded partial transcript to ${envResult.envName}`, {
          transcriptId: envResult.transcriptId,
          sessionId: payload.sessionId.substring(0, 8),
          eventCount: result.eventCount,
        });
      } else {
        logger.error(`Commit tracking: transcript upload to ${envResult.envName} failed`, {
          sessionId: payload.sessionId.substring(0, 8),
          error: envResult.error,
        });
      }
    }
  } catch (error) {
    logger.error("Commit tracking: transcript upload error", {
      sessionId: payload.sessionId.substring(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
