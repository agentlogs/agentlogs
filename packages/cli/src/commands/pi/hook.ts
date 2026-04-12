/**
 * Pi Hook Command
 *
 * Handles tool_call, tool_result, and session_shutdown events from the Pi extension.
 * Reads JSON from stdin, processes the event, and outputs JSON response (for tool_call hooks).
 */

import { existsSync, readFileSync } from "fs";
import { convertPiTranscript, type PiSessionEntry, type PiSessionHeader } from "@agentlogs/shared";
import { LiteLLMPricingFetcher } from "@agentlogs/shared/pricing";
import { resolveGitContext } from "@agentlogs/shared/claudecode";
import { uploadUnifiedToAllEnvs } from "../../lib/perform-upload";
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
  cacheCallTranscriptId,
  getCallTranscriptId,
  deleteCallTranscriptId,
} from "../../lib/hooks-shared";

// ============================================================================
// Types
// ============================================================================

interface PiHookInput {
  hook_event_name: "tool_call" | "tool_result" | "session_shutdown";
  session_id: string;
  tool_call_id?: string;
  tool?: string;
  cwd?: string;
  // For tool_call
  tool_input?: {
    command?: string;
    [key: string]: unknown;
  };
  // For tool_result
  tool_output?: {
    stdout?: string;
    content?: string;
    [key: string]: unknown;
  };
  // For session_shutdown
  session_file?: string;
  leaf_id?: string;
  // Optional: pre-serialized session data from extension
  session_data?: {
    header: PiSessionHeader;
    entries: PiSessionEntry[];
  };
}

interface HookResponse {
  modified: boolean;
  updatedInput?: Record<string, unknown>;
}

// ============================================================================
// Main Hook Command
// ============================================================================

export async function piHookCommand(): Promise<void> {
  const startTime = Date.now();
  let eventName: string | undefined;
  let sessionId: string | undefined;

  try {
    const { preview, full } = await readStdinWithPreview();

    logger.info(`Pi hook invoked (stdin: ${full.length} bytes)`);

    if (!full.trim()) {
      logger.warn("Pi hook received empty stdin - ignoring");
      outputResponse({ modified: false });
      process.exit(0);
    }

    // Quick check: for tool_call, skip parsing if not a potential git commit
    const isToolCall = preview.includes("tool_call") && !preview.includes("tool_call_id");
    const mightBeGitCommit = preview.includes("git") && preview.includes("commit");
    if (isToolCall && !mightBeGitCommit) {
      outputResponse({ modified: false });
      const duration = Date.now() - startTime;
      logger.info(`Pi hook completed: tool_call (fast path, ${duration}ms)`);
      process.exit(0);
    }

    let hookInput: PiHookInput;
    try {
      hookInput = JSON.parse(full) as PiHookInput;
    } catch (error) {
      logger.error("Pi hook failed to parse stdin JSON", {
        error: error instanceof Error ? error.message : error,
      });
      outputResponse({ modified: false });
      process.exit(1);
    }

    eventName = hookInput.hook_event_name;
    sessionId = hookInput.session_id || "unknown";

    if (!eventName) {
      logger.error("Pi hook missing event name", { sessionId });
      outputResponse({ modified: false });
      process.exit(1);
    }

    logger.info(`Pi hook: ${eventName} (session: ${sessionId.substring(0, 8)}...)`);

    if (eventName === "tool_call") {
      await handleToolCall(hookInput);
    } else if (eventName === "tool_result") {
      await handleToolResult(hookInput);
      outputResponse({ modified: false });
    } else if (eventName === "session_shutdown") {
      await handleSessionShutdown(hookInput);
      outputResponse({ modified: false });
    } else if (eventName === "agent_end") {
      await handleAgentEnd(hookInput);
      outputResponse({ modified: false });
    } else {
      logger.debug(`Pi hook: skipping unsupported event ${eventName}`);
      outputResponse({ modified: false });
    }

    const duration = Date.now() - startTime;
    logger.info(`Pi hook completed: ${eventName} (${duration}ms)`, {
      sessionId: sessionId.substring(0, 8),
    });
    process.exit(0);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Pi hook failed: ${eventName || "unknown"} (${duration}ms)`, {
      sessionId: sessionId?.substring(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
    outputResponse({ modified: false });
    process.exit(1);
  }
}

function outputResponse(response: HookResponse): void {
  process.stdout.write(JSON.stringify(response));
}

// ============================================================================
// Event Handlers
// ============================================================================

async function handleToolCall(hookInput: PiHookInput): Promise<void> {
  const sessionId = hookInput.session_id;
  const toolCallId = hookInput.tool_call_id;
  const tool = hookInput.tool || "";
  const toolInput = hookInput.tool_input || {};
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  const cwd = hookInput.cwd;

  const isBashTool = tool.toLowerCase() === "bash";

  // Check if repo is allowed
  const repoId = await getRepoIdFromCwd(cwd);
  const repoAllowed = isRepoAllowed(repoId);

  if (isBashTool && containsGitCommit(command) && repoAllowed && shouldAddTranscriptLinkToCommit(repoId)) {
    // Generate stable transcript ID
    const transcriptId = await getOrCreateTranscriptId(sessionId);

    // Append transcript link to commit message
    const transcriptBaseUrl = await getPreferredTranscriptBaseUrl();
    const updatedCommand = appendTranscriptLink(command, transcriptId, transcriptBaseUrl);

    if (updatedCommand !== command) {
      logger.info("Pi hook: intercepting git commit", {
        sessionId: sessionId.substring(0, 8),
        transcriptId,
        toolCallId,
      });

      // Cache toolCallId -> transcriptId for the result hook
      if (toolCallId) {
        await cacheCallTranscriptId(toolCallId, transcriptId);
      }

      // Upload partial transcript immediately so the link works
      await uploadPartialTranscript(hookInput);

      // Return modified input
      outputResponse({
        modified: true,
        updatedInput: {
          ...toolInput,
          command: updatedCommand,
        },
      });
      return;
    }
  }

  outputResponse({ modified: false });
}

async function handleToolResult(hookInput: PiHookInput): Promise<void> {
  const sessionId = hookInput.session_id;
  const toolCallId = hookInput.tool_call_id;
  const tool = hookInput.tool || "";
  const toolOutput = hookInput.tool_output || {};
  const cwd = hookInput.cwd || "";

  const isBashTool = tool.toLowerCase() === "bash";
  if (!isBashTool) {
    return;
  }

  // Get output text
  const output = toolOutput.stdout || toolOutput.content || "";
  const outputStr = typeof output === "string" ? output : JSON.stringify(output);

  // Try to get transcript ID from:
  // 1. The output (if git echoed the full commit message with our link)
  // 2. The toolCallId cache (set in tool_call handler)
  let transcriptId = extractTranscriptIdFromOutput(outputStr);
  let fromCache = false;

  if (!transcriptId && toolCallId) {
    transcriptId = await getCallTranscriptId(toolCallId);
    fromCache = true;
  }

  if (!transcriptId) {
    // Not a commit we tracked
    return;
  }

  // Clean up the cache entry
  if (toolCallId) {
    await deleteCallTranscriptId(toolCallId);
  }

  // Parse commit info from git output
  const commitSha = parseCommitShaFromOutput(outputStr);
  const commitTitle = parseCommitTitleFromOutput(outputStr);
  const branch = parseBranchFromOutput(outputStr);

  if (!commitSha) {
    logger.debug("Pi tool_result: found link but no commit SHA", {
      sessionId: sessionId.substring(0, 8),
      transcriptId,
      fromCache,
    });
    return;
  }

  await trackCommit({
    transcriptId,
    repoPath: cwd,
    timestamp: new Date().toISOString(),
    commitSha,
    commitTitle,
    branch,
  });

  logger.info("Pi tool_result: tracked commit", {
    sessionId: sessionId.substring(0, 8),
    transcriptId,
    commitSha: commitSha.substring(0, 8),
    fromCache,
  });
}

async function handleSessionShutdown(hookInput: PiHookInput): Promise<void> {
  const sessionId = hookInput.session_id;

  logger.info("Pi session_shutdown: uploading transcript", {
    sessionId: sessionId.substring(0, 8),
  });

  await uploadFullTranscript(hookInput);
}

async function handleAgentEnd(hookInput: PiHookInput): Promise<void> {
  const sessionId = hookInput.session_id;

  logger.info("Pi agent_end: uploading transcript", {
    sessionId: sessionId.substring(0, 8),
  });

  await uploadFullTranscript(hookInput);
}

// ============================================================================
// Transcript Upload
// ============================================================================

function readSessionFromFile(sessionFile: string): { header: PiSessionHeader; entries: PiSessionEntry[] } | null {
  if (!existsSync(sessionFile)) {
    return null;
  }

  try {
    const content = readFileSync(sessionFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    if (lines.length === 0) {
      return null;
    }

    const header = JSON.parse(lines[0]) as PiSessionHeader;
    const entries: PiSessionEntry[] = [];

    for (let i = 1; i < lines.length; i++) {
      try {
        entries.push(JSON.parse(lines[i]) as PiSessionEntry);
      } catch {
        // Skip malformed lines
      }
    }

    return { header, entries };
  } catch (error) {
    logger.error("Pi: failed to read session file", {
      sessionFile,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function uploadPartialTranscript(hookInput: PiHookInput): Promise<void> {
  const sessionId = hookInput.session_id;
  const cwd = hookInput.cwd;

  // Prefer pre-serialized session data from extension
  let sessionData = hookInput.session_data;

  // Fall back to reading from file
  if (!sessionData && hookInput.session_file) {
    sessionData = readSessionFromFile(hookInput.session_file) ?? undefined;
  }

  if (!sessionData) {
    logger.warn("Pi partial upload: no session data available", {
      sessionId: sessionId.substring(0, 8),
    });
    return;
  }

  await doUpload(sessionData, sessionId, cwd, hookInput.leaf_id, "partial");
}

async function uploadFullTranscript(hookInput: PiHookInput): Promise<void> {
  const sessionId = hookInput.session_id;
  const cwd = hookInput.cwd;

  // Prefer pre-serialized session data from extension
  let sessionData = hookInput.session_data;

  // Fall back to reading from file
  if (!sessionData && hookInput.session_file) {
    sessionData = readSessionFromFile(hookInput.session_file) ?? undefined;
  }

  if (!sessionData) {
    logger.warn("Pi full upload: no session data available", {
      sessionId: sessionId.substring(0, 8),
    });
    return;
  }

  await doUpload(sessionData, sessionId, cwd, hookInput.leaf_id, "full");
}

async function doUpload(
  sessionData: { header: PiSessionHeader; entries: PiSessionEntry[] },
  sessionId: string,
  cwd?: string,
  leafId?: string,
  uploadType: "partial" | "full" = "full",
): Promise<void> {
  try {
    const pricingFetcher = new LiteLLMPricingFetcher();
    const pricingData = await pricingFetcher.fetchModelPricing();
    const pricing = Object.fromEntries(pricingData);

    const directory = cwd || sessionData.header.cwd || process.cwd();
    const gitContext = await resolveGitContext(directory, undefined);

    const result = convertPiTranscript(sessionData, {
      pricing,
      gitContext,
      cwd: directory,
      leafId,
    });

    if (!result) {
      logger.error(`Pi ${uploadType} upload: failed to convert transcript`, {
        sessionId: sessionId.substring(0, 8),
      });
      return;
    }

    const uploadResult = await uploadUnifiedToAllEnvs({
      unifiedTranscript: result.transcript,
      sessionId,
      cwd: directory,
    });

    if (uploadResult.skipped) {
      logger.info(`Pi ${uploadType} upload: skipped (repo not allowed)`, {
        sessionId: sessionId.substring(0, 8),
      });
      return;
    }

    for (const envResult of uploadResult.results) {
      if (envResult.success) {
        logger.info(`Pi ${uploadType} upload: success (${envResult.envName})`, {
          sessionId: sessionId.substring(0, 8),
          transcriptId: uploadResult.id,
        });
      } else {
        logger.error(`Pi ${uploadType} upload: failed (${envResult.envName})`, {
          sessionId: sessionId.substring(0, 8),
          error: envResult.error,
        });
      }
    }
  } catch (error) {
    logger.error(`Pi ${uploadType} upload: error`, {
      sessionId: sessionId.substring(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
