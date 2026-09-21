/**
 * AgentLogs OpenCode Plugin (OpenCode v1 + v2 in one package)
 *
 * Lightweight plugin that shells out to the agentlogs CLI for all processing.
 * The CLI handles transcript uploads, git commit interception, and commit tracking.
 *
 * OpenCode 2 loads the default export's `id` + `setup(ctx)` (Plugin.define).
 * OpenCode 1 (1.18.29+) calls the default export's `server(input)` function.
 * Both adapters delegate to the same location handlers, which is why each hook
 * payload tags the source OpenCode version (`opencode_version`) so the CLI
 * knows which export path to use instead of probing the `opencode` binary.
 *
 * @example
 * // opencode.json (v2)
 * { "plugins": ["@agentlogs/opencode"] }
 */

import { appendFileSync } from "node:fs";
import { Plugin } from "@opencode/plugin";
import { type Clock, type CliCommand, createHookQueue, createIdleUploadScheduler, resolveCli } from "./hooks";
import { type HookPayload, type HookResponse, runHook } from "./process";

// ============================================================================
// Debug Logging (compiled out in production builds)
// ============================================================================

const LOG_FILE = "/tmp/agentlogs-opencode.log";
const TRANSCRIPT_LINK_REGEX = /https?:\/\/[^\s"'`]+\/s\/[a-zA-Z0-9_-]+/;
// Bash tool id across OpenCode versions: "bash" (v1), "shell" (v2).
const BASH_TOOLS = new Set(["bash", "shell", "execute"]);

/**
 * Which OpenCode API generation this plugin instance runs inside. The CLI uses
 * it to pick the transcript export path (no binary sniffing needed).
 */
export type OpenCodeVersion = "1" | "2";

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
// Canonical Hook Event Shapes
// ============================================================================
// Version-neutral shapes produced by both adapters. Kept structural (no SDK
// brands) so tests can drive the handlers without depending on either package.

export interface ToolExecuteBeforeEvent {
  tool: string;
  sessionID: string;
  id: string;
  input: unknown;
}

export interface ToolResultLike {
  content?: string | ReadonlyArray<{ type: string; text?: string }>;
  metadata?: Record<string, unknown>;
}

export type ToolExecuteAfterEvent =
  | {
      tool: string;
      sessionID: string;
      id: string;
      input: unknown;
      status: "completed";
      result: ToolResultLike;
    }
  | {
      tool: string;
      sessionID: string;
      id: string;
      input: unknown;
      status: "error";
      error?: unknown;
    };

// ============================================================================
// Location Handlers (shared core)
// ============================================================================

export interface LocationHandlers {
  dispose(): void;
  scheduleIdle(sessionId: string): void;
  before(event: ToolExecuteBeforeEvent): Promise<void>;
  after(event: ToolExecuteAfterEvent): Promise<void>;
}

function contentToOutput(content: ToolResultLike["content"]): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n");
}

/**
 * Event types that signal "the session completed a unit of work; publish it".
 * `session.idle` is the primary signal but is not delivered on the plugin event
 * stream in every flow, so completion events are reliable fallbacks.
 */
export function isPublishTrigger(eventType: string): boolean {
  return (
    eventType === "session.idle" ||
    eventType === "session.execution.succeeded" ||
    eventType === "session.execution.failed" ||
    eventType === "session.execution.interrupted"
  );
}

/**
 * Read the session id out of a subscribed event, tolerating the fact that the
 * event data union only sometimes carries one.
 */
function eventSessionID(event: { type: string; data?: unknown }): string {
  const data = event.data;
  if (data && typeof data === "object" && "sessionID" in data) {
    const id = (data as { sessionID?: unknown }).sessionID;
    if (typeof id === "string") return id;
  }
  return "";
}

function createLocationHandlers(options: {
  cwd: string;
  version: OpenCodeVersion;
  enqueue: ReturnType<typeof createHookQueue>;
  run: (payload: HookPayload, cwd: string) => Promise<HookResponse>;
  clock?: Clock;
}): LocationHandlers {
  const { cwd, version, enqueue, run } = options;
  const idleUploads = createIdleUploadScheduler(enqueue, options.clock);
  // Track callIds where we intercepted a git commit. Used to know when to call
  // the CLI in the after hook (git output may not include our link).
  const interceptedCallIds = new Set<string>();

  return {
    dispose: () => idleUploads.dispose(),

    scheduleIdle(sessionId: string) {
      if (!sessionId) return;
      log(`${version}: session.idle`, { sessionId });
      idleUploads.schedule(sessionId, () =>
        run(
          {
            hook_event_name: "session.idle",
            session_id: sessionId,
            cwd,
            opencode_version: version,
          },
          cwd,
        ).catch((err) => log("session.idle hook error", { error: String(err) })),
      );
    },

    async before(event: ToolExecuteBeforeEvent) {
      // Only intercept bash/shell tools
      if (!BASH_TOOLS.has(event.tool)) return;

      // Quick check: skip if not a git commit
      const input = event.input as { command?: unknown } | undefined;
      const command = typeof input?.command === "string" ? input.command : "";
      if (typeof command !== "string" || !/\bgit\s+commit\b/.test(command)) return;

      log("tool.execute.before (git commit)", {
        tool: event.tool,
        sessionID: event.sessionID,
        id: event.id,
      });

      const response = await enqueue(() =>
        run(
          {
            hook_event_name: "tool.execute.before",
            session_id: event.sessionID,
            call_id: event.id,
            tool: event.tool,
            tool_input: input,
            cwd,
            opencode_version: version,
          },
          cwd,
        ),
      ).catch((err) => {
        log("tool.execute.before hook error", { error: String(err) });
        return { modified: false } as HookResponse;
      });

      if (response.modified && response.args) {
        log("tool.execute.before: args modified", { modified: true });
        // Track this callId so we know to call the CLI in the after hook
        interceptedCallIds.add(event.id);
        // Mutate in place - don't replace the reference, as OpenCode passes the
        // tool input by reference.
        if (input && typeof input === "object") {
          Object.assign(input, response.args);
        }
      }
    },

    async after(event: ToolExecuteAfterEvent) {
      if (event.status !== "completed") return;
      // Only handle bash tool
      if (!BASH_TOOLS.has(event.tool)) return;

      // Check if we should call the CLI:
      // 1. This callId was intercepted in the before hook (we modified the commit command)
      // 2. Output contains our transcript link (fallback check)
      const wasIntercepted = interceptedCallIds.has(event.id);
      const output = contentToOutput(event.result?.content);
      const metadata = event.result?.metadata ?? {};
      const hasLink = TRANSCRIPT_LINK_REGEX.test(output);

      if (!wasIntercepted && !hasLink) return;

      // Clean up tracked callId
      interceptedCallIds.delete(event.id);

      // Fire and forget - CLI handles commit tracking. Serialized to avoid
      // concurrent CLI spawns (npm's install lock can't handle parallel runs).
      enqueue(() =>
        run(
          {
            hook_event_name: "tool.execute.after",
            session_id: event.sessionID,
            call_id: event.id,
            tool: event.tool,
            tool_output: { output, metadata },
            cwd,
            opencode_version: version,
          },
          cwd,
        ).catch((err) => log("tool.execute.after hook error", { error: String(err) })),
      );
    },
  };
}

// ============================================================================
// OpenCode 1 Server Adapter
// ============================================================================
// V1 (1.18.29+) calls the default export's `server(input)` per project and uses
// the returned hooks object.

export interface OpenCode1Context {
  directory: string;
  project?: { id: string; path: string };
}

export interface OpenCode1HookInput {
  tool: string;
  sessionID: string;
  callID: string;
}

export interface OpenCode1BeforeOutput {
  args?: Record<string, unknown>;
}

export interface OpenCode1AfterOutput {
  output?: string;
  metadata?: Record<string, unknown>;
}

export interface OpenCode1Event {
  type: string;
  properties?: { sessionID?: string };
}

export interface OpenCode1Hooks {
  dispose: () => void;
  event(rawEvent: unknown): void;
  "tool.execute.before"(input: OpenCode1HookInput, output: OpenCode1BeforeOutput): Promise<void>;
  "tool.execute.after"(input: OpenCode1HookInput, output: OpenCode1AfterOutput): Promise<void>;
}

function createOpenCode1Adapter(input: OpenCode1Context, handlers: LocationHandlers): OpenCode1Hooks {
  return {
    dispose: () => handlers.dispose(),

    event(rawEvent: unknown) {
      const event = (rawEvent as { event?: OpenCode1Event })?.event ?? (rawEvent as OpenCode1Event);
      if (event?.type !== "session.idle") return;
      handlers.scheduleIdle(event.properties?.sessionID ?? "");
    },

    "tool.execute.before": (input: OpenCode1HookInput, output: OpenCode1BeforeOutput) =>
      handlers.before({
        tool: input.tool,
        sessionID: input.sessionID,
        id: input.callID,
        input: output.args,
      }),

    "tool.execute.after": (input: OpenCode1HookInput, output: OpenCode1AfterOutput) =>
      handlers.after({
        tool: input.tool,
        sessionID: input.sessionID,
        id: input.callID,
        status: "completed",
        input: undefined,
        result: { content: output.output, metadata: output.metadata },
      }),
  };
}

// ============================================================================
// Main Plugin
// ============================================================================

export interface CreateOptions {
  run?: (payload: HookPayload, cwd: string) => Promise<HookResponse>;
  clock?: Clock;
}

export type AgentLogsPlugin = ReturnType<typeof createAgentLogsPlugin>;

/**
 * Build the OpenCode 2 plugin definition, sharing one CLI queue (and CLI
 * resolution) across every project location the plugin is loaded for.
 * The default export also exposes the V1 `server` entrypoint.
 */
export function createAgentLogsPlugin(options: CreateOptions = {}) {
  const enqueueHook = createHookQueue();
  let cli: CliCommand | undefined;
  const run =
    options.run ?? ((payload: HookPayload, cwd: string) => runHook((cli ??= resolveCli()), payload, cwd, { log }));

  const makeHandlers = (cwd: string, version: OpenCodeVersion): LocationHandlers =>
    createLocationHandlers({ cwd, version, enqueue: enqueueHook, run, clock: options.clock });

  const plugin = Plugin.define({
    id: "agentlogs",
    async setup(ctx: Plugin.Context) {
      const cwd = ctx.location.directory;
      const handlers = makeHandlers(cwd, "2");

      log("Plugin initialized (opencode v2)", {
        directory: cwd,
        projectId: ctx.location.project?.id,
      });

      await ctx.tool.hook("execute.before", (event) =>
        handlers.before({ tool: event.tool, sessionID: event.sessionID, id: event.id, input: event.input }),
      );
      await ctx.tool.hook("execute.after", (event) =>
        handlers.after(
          event.status === "completed"
            ? {
                tool: event.tool,
                sessionID: event.sessionID,
                id: event.id,
                input: event.input,
                status: "completed",
                result: {
                  content: event.result?.content,
                  metadata: event.result?.metadata,
                },
              }
            : {
                tool: event.tool,
                sessionID: event.sessionID,
                id: event.id,
                input: event.input,
                status: "error",
                error: event.error,
              },
        ),
      );

      const controller = new AbortController();
      void (async () => {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          if (isPublishTrigger(event.type)) handlers.scheduleIdle(eventSessionID(event));
        }
      })().catch((error) => log("event subscription error", { error: String(error) }));

      return () => {
        controller.abort();
        handlers.dispose();
      };
    },
  });

  const server = async (input: OpenCode1Context) => {
    const cwd = input.directory;
    const handlers = makeHandlers(cwd, "1");
    log("Plugin initialized (opencode v1)", {
      directory: cwd,
      projectId: input.project?.id,
    });
    return createOpenCode1Adapter(input, handlers);
  };

  return {
    plugin: { ...plugin, server },
    handlers: (cwd: string, version: OpenCodeVersion = "2") => makeHandlers(cwd, version),
  };
}
