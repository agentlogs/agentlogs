/**
 * AgentLogs OpenCode Plugin
 *
 * Lightweight plugin that shells out to the agentlogs CLI for all processing.
 * The CLI handles transcript uploads, git commit interception, and commit tracking.
 *
 * @example
 * // opencode.json
 * { "plugin": ["@agentlogs/opencode"] }
 */

import { appendFileSync } from "node:fs";
import { spawn } from "node:child_process";
import {
  CliCommand,
  enqueueHook,
  markIdleUploadFinished,
  markIdleUploadStarted,
  resolveCli,
  shouldRunIdleUpload,
} from "./lib/hooks";

// ============================================================================
// Debug Logging (compiled out in production builds)
// ============================================================================

const LOG_FILE = "/tmp/agentlogs-opencode.log";
const TRANSCRIPT_LINK_REGEX = /https?:\/\/[^\s"'`]+\/s\/[a-zA-Z0-9_-]+/;

function log(message: string, data?: unknown): void {
  if (process.env.NODE_ENV === "production") return;
  const timestamp = new Date().toISOString();
  const logLine = data
    ? `[${timestamp}] ${message}\n${JSON.stringify(data, null, 2)}\n`
    : `[${timestamp}] ${message}\n`;
  try {
    appendFileSync(LOG_FILE, logLine);
  } catch {
    // Ignore write errors
  }
}

// ============================================================================
// Types
// ============================================================================

interface PluginContext {
  directory: string;
  worktree?: string;
  project?: { id: string; path: string };
}

interface HookPayload {
  hook_event_name: string;
  session_id: string;
  call_id?: string;
  tool?: string;
  cwd?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
}

interface HookResponse {
  modified: boolean;
  args?: Record<string, unknown>;
}

// ============================================================================
// CLI Resolution (resolved once, cached for the lifetime of the plugin)
// ============================================================================

let resolvedCli: CliCommand | null = null;

function getCli(): CliCommand {
  if (!resolvedCli) {
    resolvedCli = resolveCli();
    log("Resolved CLI", resolvedCli);
  }
  return resolvedCli;
}

// ============================================================================
// CLI Integration
// ============================================================================

/**
 * Shell out to the agentlogs CLI hook command.
 * Passes hook data via stdin, receives response via stdout.
 */
async function runHook(payload: HookPayload, cwd: string): Promise<HookResponse> {
  const { command, args } = getCli();
  const runArgs = [...args, "opencode", "hook"];

  log("Running hook", { command, args: runArgs, payload: payload.hook_event_name });

  return new Promise((resolve) => {
    const proc = spawn(command, runArgs, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    // Send payload via stdin
    proc.stdin.write(JSON.stringify(payload));
    proc.stdin.end();

    proc.on("close", (code) => {
      log("Hook process exited", { code, stdout: stdout.slice(0, 500), stderr: stderr.slice(0, 500) });

      if (code === 0 && stdout.trim()) {
        try {
          const response = JSON.parse(stdout.trim()) as HookResponse;
          resolve(response);
        } catch {
          resolve({ modified: false });
        }
      } else {
        resolve({ modified: false });
      }
    });

    proc.on("error", (err) => {
      log("Hook spawn error", { error: String(err) });
      resolve({ modified: false });
    });
  });
}

// ============================================================================
// Main Plugin
// ============================================================================

export const agentLogsPlugin = async (ctx: PluginContext) => {
  // Resolve the CLI invocation once up front (cached for the plugin lifetime).
  getCli();

  log("Plugin initialized", {
    directory: ctx.directory,
    projectId: ctx.project?.id,
  });

  // Track callIds where we intercepted a git commit
  // Used to know when to call CLI in after hook (git output may not include our link)
  const interceptedCallIds = new Set<string>();

  return {
    // Handle session events (for session.idle upload)
    event: async (rawEvent: any) => {
      const event = rawEvent?.event ?? rawEvent;
      const eventType = event?.type;
      const properties = event?.properties;

      // Only handle session.idle for uploads
      if (eventType === "session.idle") {
        const sessionId = properties?.sessionID;
        if (!sessionId) return;

        // Throttle: opencode may emit session.idle repeatedly (even within the
        // same millisecond). Each event used to spawn a fresh CLI process, so
        // skip when this session is already uploading or uploaded recently.
        if (!shouldRunIdleUpload(sessionId)) {
          return;
        }

        markIdleUploadStarted(sessionId);
        log("session.idle", { sessionId });

        // Fire and forget - CLI handles the upload. Serialized so bursts of
        // session.idle events don't spawn concurrent CLI processes.
        enqueueHook(() =>
          runHook(
            {
              hook_event_name: "session.idle",
              session_id: sessionId,
              cwd: ctx.directory,
            },
            ctx.directory,
          )
            .catch((err) => log("session.idle hook error", { error: String(err) }))
            .finally(() => markIdleUploadFinished(sessionId)),
        );
      }
    },

    // Hook: Called before any tool executes
    "tool.execute.before": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { args: any },
    ) => {
      // Only intercept bash/shell tools
      if (input.tool !== "bash") {
        return;
      }

      // Quick check: skip if not a git commit
      const command = output.args?.command;
      if (typeof command !== "string" || !/\bgit\s+commit\b/.test(command)) {
        return;
      }

      log("tool.execute.before (git commit)", {
        tool: input.tool,
        sessionID: input.sessionID,
        callID: input.callID,
      });

      const response = await runHook(
        {
          hook_event_name: "tool.execute.before",
          session_id: input.sessionID,
          call_id: input.callID,
          tool: input.tool,
          tool_input: output.args,
          cwd: ctx.directory,
        },
        ctx.directory,
      );

      if (response.modified && response.args) {
        log("tool.execute.before: args modified", { modified: true });
        // Track this callId so we know to call CLI in after hook
        interceptedCallIds.add(input.callID);
        // Mutate in place - don't replace the reference, as OpenCode passes { args } by reference
        Object.assign(output.args, response.args);
      }
    },

    // Hook: Called after any tool executes
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: any },
    ) => {
      // Only handle bash tool
      if (input.tool !== "bash") {
        return;
      }

      // Check if we should call CLI:
      // 1. This callId was intercepted in before hook (we modified the commit command)
      // 2. Output contains our transcript link (fallback check)
      const wasIntercepted = interceptedCallIds.has(input.callID);
      const cmdOutput = output.output || "";
      const hasLink = TRANSCRIPT_LINK_REGEX.test(cmdOutput);

      if (!wasIntercepted && !hasLink) {
        return;
      }

      // Clean up tracked callId
      interceptedCallIds.delete(input.callID);

      // Fire and forget - CLI handles commit tracking. Serialized to avoid
      // concurrent CLI spawns (npm's install lock can't handle parallel runs).
      enqueueHook(() =>
        runHook(
          {
            hook_event_name: "tool.execute.after",
            session_id: input.sessionID,
            call_id: input.callID,
            tool: input.tool,
            tool_output: output,
            cwd: ctx.directory,
          },
          ctx.directory,
        ).catch((err) => log("tool.execute.after hook error", { error: String(err) })),
      );
    },
  };
};

export default agentLogsPlugin;
