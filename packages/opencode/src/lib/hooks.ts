/**
 * Internal helpers for the AgentLogs OpenCode plugin.
 *
 * Kept in a separate module (not the plugin entrypoint) because the OpenCode
 * plugin loader treats every export of the plugin module as a plugin instance.
 */

import { spawnSync } from "node:child_process";

// ============================================================================
// Configuration
// ============================================================================

// Coalesce repeated idle events while retaining the last update in each interval.
export const IDLE_UPLOAD_MIN_INTERVAL_MS = 60_000;

// ============================================================================
// CLI Resolution
// ============================================================================

export interface CliCommand {
  command: string;
  args: string[];
}

/**
 * Resolve the CLI invocation used for all hook work.
 *
 * Priority:
 * 1. VI_CLI_PATH (dev mode) - e.g. "bun /path/to/packages/cli/src/index.ts"
 * 2. An `agentlogs` binary already on PATH (avoids per-event npm installs)
 * 3. `npx -y agentlogs@latest` (last resort, installs on demand)
 */
export function resolveCli(
  cliPath?: string,
  detectBinary: (name: string) => string | undefined = detectBinaryOnPath,
): CliCommand {
  const path = cliPath ?? process.env.VI_CLI_PATH;
  if (path) {
    const parts = path.split(" ");
    return { command: parts[0], args: parts.slice(1) };
  }

  const binary = detectBinary("agentlogs");
  if (binary) {
    return { command: binary, args: [] };
  }

  return { command: "npx", args: ["-y", "agentlogs@latest"] };
}

function detectBinaryOnPath(name: string): string | undefined {
  try {
    const which = spawnSync("which", [name], { encoding: "utf8" });
    if (which.status === 0 && which.stdout.trim()) {
      return which.stdout.trim().split("\n")[0];
    }
  } catch {
    // Not found - fall through to the npx fallback
  }
  return undefined;
}

// ============================================================================
// Hook Scheduling
// ============================================================================

export function createHookQueue() {
  let queue: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = queue.then(task);
    queue = result.catch(() => undefined);
    return result;
  };
}

export interface Clock {
  now(): number;
  setTimeout(callback: () => void, delay: number): ReturnType<typeof setTimeout>;
  clearTimeout(timer: ReturnType<typeof setTimeout>): void;
}

const systemClock: Clock = {
  now: () => Date.now(),
  setTimeout: (callback, delay) => {
    const timer = setTimeout(callback, delay);
    timer.unref();
    return timer;
  },
  clearTimeout: (timer) => clearTimeout(timer),
};

interface IdleUpload {
  pending?: () => Promise<unknown>;
  queued: boolean;
  lastStarted: number;
  timer?: ReturnType<typeof setTimeout>;
}

export function createIdleUploadScheduler(
  enqueue: ReturnType<typeof createHookQueue>,
  clock: Clock = systemClock,
  minIntervalMs = IDLE_UPLOAD_MIN_INTERVAL_MS,
) {
  const sessions = new Map<string, IdleUpload>();
  let disposed = false;

  function wake(sessionId: string, state: IdleUpload) {
    if (disposed || state.queued) return;
    const delay = state.lastStarted + minIntervalMs - clock.now();
    if (delay > 0) {
      state.timer ??= clock.setTimeout(() => {
        state.timer = undefined;
        wake(sessionId, state);
      }, delay);
      return;
    }
    if (!state.pending) {
      sessions.delete(sessionId);
      return;
    }

    state.queued = true;
    const finished = () => {
      state.queued = false;
      wake(sessionId, state);
    };
    // Consume the latest request only when the job starts. Requests received
    // during execution remain pending for a trailing upload after completion.
    void enqueue(async () => {
      if (disposed) return;
      const task = state.pending;
      state.pending = undefined;
      state.lastStarted = clock.now();
      await task?.();
    }).then(finished, finished);
  }

  return {
    schedule(sessionId: string, task: () => Promise<unknown>) {
      if (disposed) return;
      let state = sessions.get(sessionId);
      if (!state) {
        state = { queued: false, lastStarted: -Infinity };
        sessions.set(sessionId, state);
      }
      state.pending = task;
      wake(sessionId, state);
    },
    dispose() {
      disposed = true;
      for (const state of sessions.values()) {
        if (state.timer) clock.clearTimeout(state.timer);
      }
      sessions.clear();
    },
  };
}
