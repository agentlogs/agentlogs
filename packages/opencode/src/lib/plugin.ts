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
import { type Clock, type CliCommand, createHookQueue, createIdleUploadScheduler, resolveCli } from "./hooks";
import { type HookPayload, type HookResponse, runHook } from "./process";

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

// ============================================================================
// Main Plugin
// ============================================================================

export function createAgentLogsPlugin(
  options: {
    run?: (payload: HookPayload, cwd: string) => Promise<HookResponse>;
    clock?: Clock;
  } = {},
) {
  // All instances in this OpenCode process share one CLI queue, including
  // awaited before-hooks. Each instance owns its idle timers and lifecycle.
  const enqueueHook = createHookQueue();
  let cli: CliCommand | undefined;
  const run = options.run ?? ((payload, cwd) => runHook((cli ??= resolveCli()), payload, cwd, { log }));
  return async (ctx: PluginContext) => {
    if (!options.run) cli ??= resolveCli();
    const idleUploads = createIdleUploadScheduler(enqueueHook, options.clock);

    log("Plugin initialized", {
      directory: ctx.directory,
      projectId: ctx.project?.id,
    });

    // Track callIds where we intercepted a git commit
    // Used to know when to call CLI in after hook (git output may not include our link)
    const interceptedCallIds = new Set<string>();

    return {
      dispose: async () => idleUploads.dispose(),
      // Handle session events (for session.idle upload)
      event: async (rawEvent: any) => {
        const event = rawEvent?.event ?? rawEvent;
        const eventType = event?.type;
        const properties = event?.properties;

        // Only handle session.idle for uploads
        if (eventType === "session.idle") {
          const sessionId = properties?.sessionID;
          if (!sessionId) return;

          log("session.idle", { sessionId });
          idleUploads.schedule(sessionId, () =>
            run(
              {
                hook_event_name: "session.idle",
                session_id: sessionId,
                cwd: ctx.directory,
              },
              ctx.directory,
            ).catch((err) => log("session.idle hook error", { error: String(err) })),
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

        const response = await enqueueHook(() =>
          run(
            {
              hook_event_name: "tool.execute.before",
              session_id: input.sessionID,
              call_id: input.callID,
              tool: input.tool,
              tool_input: output.args,
              cwd: ctx.directory,
            },
            ctx.directory,
          ),
        ).catch((err) => {
          log("tool.execute.before hook error", { error: String(err) });
          return { modified: false } as HookResponse;
        });

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
          run(
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
}
