/**
 * Codex Hook Command
 *
 * Handles SessionStart and Stop events from Codex hooks.
 * Reads JSON from stdin, uploads transcripts on Stop, and writes a JSON response.
 */

import { performUploadToAllEnvs, type MultiEnvUploadResult } from "../../lib/perform-upload";
import { hookLogger as logger, readStdinWithPreview } from "../../lib/hooks-shared";

export interface CodexHookInput {
  session_id?: string;
  transcript_path?: string | null;
  cwd?: string;
  hook_event_name?: "SessionStart" | "Stop" | string;
  model?: string;
  permission_mode?: string;
  source?: string;
  stop_hook_active?: boolean;
  last_assistant_message?: string | null;
  [key: string]: unknown;
}

export type CodexHookOutput = Record<string, never>;

type CodexUploadFn = (params: Parameters<typeof performUploadToAllEnvs>[0]) => Promise<MultiEnvUploadResult>;

const EMPTY_RESPONSE: CodexHookOutput = {};

export async function processCodexHookInput(
  hookInput: CodexHookInput,
  uploadFn: CodexUploadFn = performUploadToAllEnvs,
): Promise<CodexHookOutput> {
  const eventName = hookInput.hook_event_name;
  const sessionId = typeof hookInput.session_id === "string" ? hookInput.session_id : "unknown";

  if (eventName !== "Stop") {
    logger.debug("Codex hook: skipping non-stop event", {
      eventName,
      sessionId: sessionId.substring(0, 8),
    });
    return EMPTY_RESPONSE;
  }

  const transcriptPath = typeof hookInput.transcript_path === "string" ? hookInput.transcript_path : undefined;
  if (!transcriptPath) {
    logger.warn("Codex Stop: missing transcript_path", { sessionId: sessionId.substring(0, 8) });
    return EMPTY_RESPONSE;
  }

  try {
    const result = await uploadFn({
      transcriptPath,
      sessionId: hookInput.session_id,
      cwdOverride: typeof hookInput.cwd === "string" ? hookInput.cwd : undefined,
      source: "codex",
    });

    logUploadResults("Stop", sessionId, result);
  } catch (error) {
    logger.error("Codex Stop: upload error", {
      sessionId: sessionId.substring(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return EMPTY_RESPONSE;
}

export async function hookCommand(): Promise<void> {
  const startTime = Date.now();
  let eventName: string | undefined;
  let sessionId: string | undefined;

  try {
    const { full } = await readStdinWithPreview();

    logger.info(`Codex hook invoked (stdin: ${full.length} bytes)`);

    if (!full.trim()) {
      logger.warn("Codex hook received empty stdin - ignoring");
      writeResponse(EMPTY_RESPONSE);
      process.exit(0);
    }

    let hookInput: CodexHookInput;
    try {
      hookInput = JSON.parse(full) as CodexHookInput;
    } catch (error) {
      logger.error("Codex hook failed to parse stdin JSON", {
        error: error instanceof Error ? error.message : String(error),
      });
      writeResponse(EMPTY_RESPONSE);
      process.exit(1);
    }

    eventName = typeof hookInput.hook_event_name === "string" ? hookInput.hook_event_name : undefined;
    sessionId = typeof hookInput.session_id === "string" ? hookInput.session_id : undefined;

    logger.info(`Codex hook: ${eventName ?? "unknown"} (session: ${(sessionId ?? "unknown").substring(0, 8)}...)`);

    const response = await processCodexHookInput(hookInput);
    writeResponse(response);

    const duration = Date.now() - startTime;
    logger.info(`Codex hook completed: ${eventName ?? "unknown"} (${duration}ms)`, {
      sessionId: sessionId?.substring(0, 8),
    });
    process.exit(0);
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error(`Codex hook failed: ${eventName ?? "unknown"} (${duration}ms)`, {
      sessionId: sessionId?.substring(0, 8),
      error: error instanceof Error ? error.message : String(error),
    });
    writeResponse(EMPTY_RESPONSE);
    process.exit(1);
  }
}

function writeResponse(response: CodexHookOutput): void {
  process.stdout.write(JSON.stringify(response));
}

function logUploadResults(eventName: string, sessionId: string, result: MultiEnvUploadResult): void {
  if (result.results.length === 0) {
    if (!result.anySuccess) {
      logger.info(`Codex ${eventName}: upload skipped (repo not allowed or no auth)`, {
        sessionId: sessionId.substring(0, 8),
      });
    }
    return;
  }

  for (const envResult of result.results) {
    if (envResult.success) {
      logger.info(`Codex ${eventName}: uploaded to ${envResult.envName} (${result.eventCount} events)`, {
        transcriptId: envResult.transcriptId,
        sessionId: sessionId.substring(0, 8),
      });
    } else {
      logger.error(`Codex ${eventName}: upload to ${envResult.envName} failed`, {
        sessionId: sessionId.substring(0, 8),
        error: envResult.error,
      });
    }
  }
}
