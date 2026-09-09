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

// Minimum time between session.idle transcript uploads for the same session.
// opencode can emit session.idle repeatedly (bursts of events within the same
// millisecond), and every event used to spawn a fresh `npx` CLI that installs
// agentlogs from the npm registry. Throttling collapses bursts into a single
// upload and bounds upload frequency to at most once per interval.
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

// Serializes fire-and-forget hook runs so we never spawn concurrent CLI
// processes. Concurrent `npx` invocations contend on npm's install lock and
// fail with ECOMPROMISED while burning CPU; serializing prevents that pile-up.
export function enqueueHook<T>(task: () => Promise<T>): Promise<T> {
  const result = hookQueue.then(task, task);
  hookQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

let hookQueue: Promise<unknown> = Promise.resolve();

// Throttle state for session.idle uploads, keyed by session ID.
const lastIdleUpload = new Map<string, number>();
const idleUploadsInFlight = new Set<string>();

/**
 * Whether a session.idle upload should run for the given session.
 * Skips when an upload is already in flight or ran within the interval.
 */
export function shouldRunIdleUpload(
  sessionId: string,
  now = Date.now(),
  minIntervalMs = IDLE_UPLOAD_MIN_INTERVAL_MS,
): boolean {
  if (idleUploadsInFlight.has(sessionId)) {
    return false;
  }
  const last = lastIdleUpload.get(sessionId) ?? 0;
  return now - last >= minIntervalMs;
}

export function markIdleUploadStarted(sessionId: string, now = Date.now()): void {
  lastIdleUpload.set(sessionId, now);
  idleUploadsInFlight.add(sessionId);
}

export function markIdleUploadFinished(sessionId: string): void {
  idleUploadsInFlight.delete(sessionId);
}
