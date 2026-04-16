/**
 * OpenCode Hook Command
 *
 * Handles tool.execute.before, tool.execute.after, and session.idle events from OpenCode.
 * Reads JSON from stdin, processes the event, and outputs JSON response (for before hooks).
 */

import { readFileSync, unlinkSync, openSync, closeSync } from "fs";
import * as os from "os";
import spawn from "cross-spawn";
import type { OpenCodeExport } from "@agentlogs/shared";
import { convertOpenCodeTranscript } from "@agentlogs/shared/opencode";
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

interface OpenCodeHookInput {
  hook_event_name: "tool.execute.before" | "tool.execute.after" | "session.idle";
  session_id: string;
  call_id?: string;
  tool?: string;
  cwd?: string;
  // For tool.execute.before
  tool_input?: {
    command?: string;
    description?: string;
    [key: string]: unknown;
  };
  // For tool.execute.after
  tool_output?: {
    title?: string;
    output?: string;
    metadata?: {
      exit?: number;
      [key: string]: unknown;
    };
  };
}

interface HookResponse {
  modified: boolean;
  args?: Record<string, unknown>;
}

// ============================================================================
// Main Hook Command
// ============================================================================

export async function hookCommand(): Promise<void> {
  const startTime = Date.now();
  let eventName: string | undefined;
  let sessionId: string | undefined;

  try {
    const { preview, full } = await readStdinWithPreview();

    logger.info(`OpenCode hook invoked (stdin: ${full.length} bytes)`);

    if (!full.trim()) {
      logger.warn("OpenCode hook received empty stdin - ignoring");
      outputResponse({ modified: false });
      process.exit(0);
    }

    // Quick check: for tool.execute.before, skip parsing if not a potential git commit
    const isToolBefore = preview.includes("tool.execute.before");
    const mightBeGitCommit = preview.includes("git") && preview.includes("commit");
    if (isToolBefore && !mightBeGitCommit) {
      outputResponse({ modified: false });
      const duration = Date.now() - startTime;
      logger.info(`OpenCode hook completed: tool.execute.before (fast path, ${duration}ms)`);
      process.exit(0);
    }

    let hookInput: OpenCodeHookInput;
    try {
      hookInput = JSON.parse(full) as OpenCodeHookInput;
    } catch (error) {
      logger.error("OpenCode hook failed to parse stdin JSON", {
        error: error instanceof Error ? error.message : error,
      });
      outputResponse({ modified: false });
      process.exit(1);
    }

    eventName = hookInput.hook_event_name;
    sessionId = hookInput.session_id || "unknown";

    if (!eventName) {
      logger.error("OpenCode hook missing event name", { sessionId });
      outputResponse({ modified: false });
      process.exit(1);
    }

    logger.info(`OpenCode hook: ${eventName} (session: ${sessionId.substring(0, 8)}...)`);

    if (eventName === "tool.execute.before") {
      await handleToolExecuteBefore(hookInput);
    } else if (eventName === "tool.execute.after") {
      await handleToolExecuteAfter(hookInput);
      outputResponse({ modified: false });
    } else if (eventName === "session.idle") {
      await handleSessionIdle(hookInput);
      outputResponse({ modified: false });
    } else {
      logger.debug(`OpenCode hook: skipping unsupported event ${eventName}`);
      outputResponse({ modified: false });
    }

    const duration = Date.now() - startTime;
    logger.info(`OpenCode hook completed: ${eventName} (${duration}ms)`, {
      sessionId: sessionId.substring(0, 8),
    });
    process.exit(0);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`OpenCode hook failed: ${eventName || "unknown"} (${duration}ms)`, {
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

async function handleToolExecuteBefore(hookInput: OpenCodeHookInput): Promise<void> {
  const sessionId = hookInput.session_id;
  const callId = hookInput.call_id;
  const tool = hookInput.tool || "";
  const toolInput = hookInput.tool_input || {};
  const command = typeof toolInput.command === "string" ? toolInput.command : "";
  const cwd = hookInput.cwd;

  const isBashTool = tool === "bash";

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
      logger.info("OpenCode hook: intercepting git commit", {
        sessionId: sessionId.substring(0, 8),
        transcriptId,
        callId,
      });

      // Cache callId -> transcriptId for the after hook
      // (git output may not include the full commit body with our link)
      if (callId) {
        await cacheCallTranscriptId(callId, transcriptId);
      }

      // Upload partial transcript immediately so the link works
      await uploadPartialTranscript(sessionId, cwd);

      // Return modified args
      outputResponse({
        modified: true,
        args: {
          ...toolInput,
          command: updatedCommand,
        },
      });
      return;
    }
  }

  outputResponse({ modified: false });
}

async function handleToolExecuteAfter(hookInput: OpenCodeHookInput): Promise<void> {
  const sessionId = hookInput.session_id;
  const callId = hookInput.call_id;
  const tool = hookInput.tool || "";
  const toolOutput = hookInput.tool_output || {};
  const cwd = hookInput.cwd || "";

  const isBashTool = tool === "bash";
  if (!isBashTool) {
    return;
  }

  const output = toolOutput.output || "";

  // Try to get transcript ID from:
  // 1. The output (if git echoed the full commit message with our link)
  // 2. The callId cache (set in before hook, since git output may not include body)
  let transcriptId = extractTranscriptIdFromOutput(output);
  let fromCache = false;

  if (!transcriptId && callId) {
    transcriptId = await getCallTranscriptId(callId);
    fromCache = true;
  }

  if (!transcriptId) {
    // Not a commit we tracked
    return;
  }

  // Clean up the cache entry
  if (callId) {
    await deleteCallTranscriptId(callId);
  }

  // Parse commit info from git output: "[branch sha] message"
  const commitSha = parseCommitShaFromOutput(output);
  const commitTitle = parseCommitTitleFromOutput(output);
  const branch = parseBranchFromOutput(output);

  if (!commitSha) {
    // Has our link but no commit SHA - commit might have failed
    logger.debug("OpenCode PostToolUse: found link but no commit SHA", {
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

  logger.info("OpenCode PostToolUse: tracked commit", {
    sessionId: sessionId.substring(0, 8),
    transcriptId,
    commitSha: commitSha.substring(0, 8),
    fromCache,
  });
}

async function handleSessionIdle(hookInput: OpenCodeHookInput): Promise<void> {
  const sessionId = hookInput.session_id;
  const cwd = hookInput.cwd;

  logger.info("OpenCode session.idle: uploading transcript", {
    sessionId: sessionId.substring(0, 8),
  });

  await uploadFullTranscript(sessionId, cwd);
}

// ============================================================================
// Transcript Export
// ============================================================================

interface ExportResult {
  success: boolean;
  data?: OpenCodeExport;
  error?: string;
}

async function readSessionFromExport(sessionId: string): Promise<ExportResult> {
  const tmpFile = `${os.tmpdir()}/agentlogs-oc-${process.pid}-${Date.now()}.json`;
  let exitCode = 0;
  let stderr = "";

  const fd = openSync(tmpFile, "w");

  try {
    const proc = spawn("opencode", ["export", sessionId], {
      stdio: ["pipe", fd, "pipe"],
    });

    if (proc.stderr) {
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    exitCode = await new Promise<number>((resolve) => proc.on("close", resolve));
  } finally {
    closeSync(fd);
  }

  let content = "";
  try {
    content = readFileSync(tmpFile, "utf-8").trim();
  } catch {
    return {
      success: false,
      error: `Session not found`,
    };
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup
    }
  }

  stderr = stderr.trim();

  if (exitCode !== 0) {
    logger.warn("OpenCode export failed", {
      sessionId: sessionId.substring(0, 8),
      error: stderr || `exit code ${exitCode}`,
    });
    return {
      success: false,
      error: stderr || `exit code ${exitCode}`,
    };
  }

  if (!content) {
    return {
      success: false,
      error: "empty output",
    };
  }

  try {
    const data = JSON.parse(content) as OpenCodeExport;
    return { success: true, data };
  } catch (err) {
    const truncated = !content.endsWith("}");
    logger.warn("OpenCode export parse failed", {
      sessionId: sessionId.substring(0, 8),
      truncated,
      error: err instanceof Error ? err.message : "parse error",
    });
    return {
      success: false,
      error: truncated ? "truncated" : "parse error",
    };
  }
}

async function uploadPartialTranscript(sessionId: string, cwd?: string): Promise<void> {
  const result = await readSessionFromExport(sessionId);
  if (!result.success) {
    logger.warn("OpenCode partial upload: session not found", {
      sessionId: sessionId.substring(0, 8),
      error: result.error,
    });
    return;
  }

  const exportData = result.data as OpenCodeExport;
  await doUpload(exportData, sessionId, cwd, "partial");
}

async function uploadFullTranscript(sessionId: string, cwd?: string): Promise<void> {
  const result = await readSessionFromExport(sessionId);
  if (!result.success) {
    logger.warn("OpenCode full upload: session not found", {
      sessionId: sessionId.substring(0, 8),
      error: result.error,
    });
    return;
  }

  const exportData2 = result.data as OpenCodeExport;

  // Skip subagent sessions
  if (exportData2.info.parentID) {
    logger.debug("OpenCode full upload: skipping subagent session", {
      sessionId: sessionId.substring(0, 8),
    });
    return;
  }

  await doUpload(exportData2, sessionId, cwd, "full");
}

async function doUpload(
  exportData: OpenCodeExport,
  sessionId: string,
  cwd?: string,
  uploadType: "partial" | "full" = "full",
): Promise<void> {
  try {
    const pricingFetcher = new LiteLLMPricingFetcher();
    const pricingData = await pricingFetcher.fetchModelPricing();
    const pricing = Object.fromEntries(pricingData);

    const directory = cwd || exportData.info.directory || process.cwd();
    const gitContext = await resolveGitContext(directory, undefined);

    const unifiedTranscript = convertOpenCodeTranscript(exportData, {
      pricing,
      gitContext,
      cwd: directory,
    });

    if (!unifiedTranscript) {
      logger.error(`OpenCode ${uploadType} upload: failed to convert transcript`, {
        sessionId: sessionId.substring(0, 8),
      });
      return;
    }

    const result = await uploadUnifiedToAllEnvs({
      unifiedTranscript,
      sessionId,
      cwd: directory,
    });

    if (result.skipped) {
      logger.info(`OpenCode ${uploadType} upload: skipped (repo not allowed)`, {
        sessionId: sessionId.substring(0, 8),
      });
      return;
    }

    for (const envResult of result.results) {
      if (envResult.success) {
        logger.info(`OpenCode ${uploadType} upload: success (${envResult.envName})`, {
          sessionId: sessionId.substring(0, 8),
          transcriptId: result.id,
        });
      } else {
        logger.error(`OpenCode ${uploadType} upload: failed (${envResult.envName})`, {
          sessionId: sessionId.substring(0, 8),
          error: envResult.error,
        });
      }
    }
  } catch (error) {
    logger.error(`OpenCode ${uploadType} upload: error`, {
      sessionId: sessionId.substring(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
