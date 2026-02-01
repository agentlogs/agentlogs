#!/usr/bin/env node
/**
 * AgentLogs Service (agentlogsd)
 *
 * A long-running daemon that:
 * - Watches ~/.codex/sessions for transcript changes using Parcel Watcher
 * - Polls tracked session files for turn completion (token_count changes)
 * - Manages connections from MCP servers via Unix socket
 * - Shuts down gracefully after a grace period when all connections close
 */

import { subscribe, type AsyncSubscription } from "@parcel/watcher";
import {
  writeFileSync,
  appendFileSync,
  existsSync,
  mkdirSync,
  unlinkSync,
  readFileSync,
  statSync,
  readdirSync,
} from "fs";
import { dirname, join } from "path";
import { type Socket, type Server } from "net";
import { SERVICE_PID_FILE, SERVICE_LOG_FILE, CODEX_SESSIONS_DIR, WATCHER_LOG_FILE } from "./paths";
import { createIPCServer, type StatusResponse } from "./ipc";
import { performUploadToAllEnvs } from "../lib/perform-upload";

// Grace period before shutdown when all connections close (30 seconds)
const SHUTDOWN_GRACE_PERIOD_MS = 30_000;

// Poll interval for checking mtime changes (15 seconds)
const POLL_INTERVAL_MS = 15_000;

// Only track files modified in the last 1 day on startup
const MAX_FILE_AGE_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// State
// ============================================================================

const connections = new Map<string, Socket>();
let watcherSubscription: AsyncSubscription | null = null;
let ipcServer: Server | null = null;
let shutdownTimer: ReturnType<typeof setTimeout> | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let lastWatcherEvent: { type: string; path: string; timestamp: number } | undefined;
const startTime = Date.now();

// Session tracking: path -> { mtime, lastAgentMessageTs, isNew }
interface TrackedSession {
  mtime: number;
  lastAgentMessageTs: string | null;
  isNewSession: boolean; // True if created during this service run (should upload first agent_message)
}
const trackedSessions = new Map<string, TrackedSession>();

// ============================================================================
// Logging
// ============================================================================

function ensureDir(filePath: string) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function log(level: string, message: string, meta?: Record<string, unknown>) {
  const now = new Date();
  const timestamp = now.toISOString();
  const logLine = `[${timestamp}] [service] [${level}] ${message}`;

  console.log(logLine, meta ? JSON.stringify(meta) : "");

  ensureDir(SERVICE_LOG_FILE);
  try {
    appendFileSync(SERVICE_LOG_FILE, logLine + (meta ? " " + JSON.stringify(meta) : "") + "\n");
  } catch {
    // Ignore file write errors
  }
}

function logWatcherEvent(event: { type: string; path: string; reason?: string }) {
  const timestamp = Date.now();
  const logEntry = JSON.stringify({ ...event, timestamp }) + "\n";

  ensureDir(WATCHER_LOG_FILE);
  try {
    appendFileSync(WATCHER_LOG_FILE, logEntry);
  } catch {
    // Ignore file write errors
  }

  lastWatcherEvent = { type: event.type, path: event.path, timestamp };
}

// ============================================================================
// Session Tracking
// ============================================================================

/**
 * Find the last agent_message timestamp in a session file
 */
function getLastAgentMessageTimestamp(filePath: string): string | null {
  try {
    const content = readFileSync(filePath, "utf-8");
    const lines = content.trim().split("\n");

    // Search from end for last agent_message
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const line = JSON.parse(lines[i]);
        if (line.type === "event_msg" && line.payload?.type === "agent_message") {
          return line.timestamp;
        }
      } catch {
        // Skip invalid JSON lines
      }
    }
  } catch {
    // File read error
  }
  return null;
}

/**
 * Add a session file to tracking
 */
function trackSession(filePath: string, isNew: boolean = false) {
  if (!filePath.endsWith(".jsonl")) return;

  try {
    const stat = statSync(filePath);
    const lastAgentMessageTs = getLastAgentMessageTimestamp(filePath);

    trackedSessions.set(filePath, {
      mtime: stat.mtimeMs,
      lastAgentMessageTs,
      isNewSession: isNew, // New sessions should upload on first agent_message
    });

    log("DEBUG", `Tracking session: ${filePath}`, {
      isNew,
      lastAgentMessageTs,
    });
  } catch (err) {
    log("ERROR", `Failed to track session: ${filePath}`, {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Scan for recent session files on startup
 */
function scanExistingSessions() {
  const now = Date.now();
  let count = 0;

  function scanDir(dir: string) {
    if (!existsSync(dir)) return;

    try {
      const entries = readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(dir, entry.name);
        if (entry.isDirectory()) {
          scanDir(fullPath);
        } else if (entry.name.endsWith(".jsonl")) {
          try {
            const stat = statSync(fullPath);
            if (now - stat.mtimeMs < MAX_FILE_AGE_MS) {
              trackSession(fullPath, false);
              count++;
            }
          } catch {
            // Skip files we can't stat
          }
        }
      }
    } catch {
      // Skip directories we can't read
    }
  }

  scanDir(CODEX_SESSIONS_DIR);
  log("INFO", `Scanned existing sessions`, { count });
}

/**
 * Check a session file for turn completion (new agent_message)
 */
function checkSessionForTurnComplete(filePath: string) {
  const tracked = trackedSessions.get(filePath);
  if (!tracked) return;

  try {
    const stat = statSync(filePath);

    // Check if mtime changed
    if (stat.mtimeMs <= tracked.mtime) return;

    // mtime changed, update it
    tracked.mtime = stat.mtimeMs;

    // Check for new agent_message
    const newAgentMessageTs = getLastAgentMessageTimestamp(filePath);

    if (newAgentMessageTs && newAgentMessageTs !== tracked.lastAgentMessageTs) {
      const isFirstDiscovery = tracked.lastAgentMessageTs === null;
      tracked.lastAgentMessageTs = newAgentMessageTs;

      // Upload if:
      // - Not first discovery (subsequent agent messages), OR
      // - First discovery on a NEW session (created during this service run)
      if (!isFirstDiscovery || tracked.isNewSession) {
        log("INFO", `Turn completed: ${filePath}`, { agentMessageTs: newAgentMessageTs });
        logWatcherEvent({ type: "turn_complete", path: filePath, reason: "agent_message" });

        // Clear isNewSession flag after first upload
        tracked.isNewSession = false;

        // Trigger upload (fire and forget, don't block polling)
        uploadSession(filePath).catch((err) => {
          log("ERROR", `Upload failed: ${filePath}`, { error: err instanceof Error ? err.message : String(err) });
        });
      }
    }
  } catch {
    // File might have been deleted
  }
}

/**
 * Upload a session transcript
 */
async function uploadSession(filePath: string): Promise<void> {
  log("INFO", `Uploading session: ${filePath}`);

  try {
    const result = await performUploadToAllEnvs({
      transcriptPath: filePath,
      source: "codex",
    });

    if (result.anySuccess) {
      log("INFO", `Upload succeeded: ${filePath}`, {
        id: result.id,
        eventCount: result.eventCount,
        envs: result.results.filter((r) => r.success).map((r) => r.envName),
      });
      logWatcherEvent({ type: "upload_success", path: filePath });
    } else {
      log("WARN", `Upload failed for all envs: ${filePath}`, {
        errors: result.results.map((r) => ({ env: r.envName, error: r.error })),
      });
      logWatcherEvent({ type: "upload_failed", path: filePath });
    }
  } catch (err) {
    log("ERROR", `Upload error: ${filePath}`, {
      error: err instanceof Error ? err.message : String(err),
    });
    logWatcherEvent({ type: "upload_error", path: filePath });
    throw err;
  }
}

/**
 * Poll all tracked sessions for changes
 */
function pollSessions() {
  for (const filePath of trackedSessions.keys()) {
    checkSessionForTurnComplete(filePath);
  }
}

// ============================================================================
// Connection Management
// ============================================================================

function onConnect(id: string, socket: Socket) {
  connections.set(id, socket);
  log("INFO", `Connection added: ${id}`, { total: connections.size });

  // Cancel any pending shutdown
  if (shutdownTimer) {
    clearTimeout(shutdownTimer);
    shutdownTimer = null;
    log("INFO", "Shutdown cancelled - new connection");
  }
}

function onDisconnect(id: string) {
  connections.delete(id);
  log("INFO", `Connection removed: ${id}`, { total: connections.size });
  checkShutdown();
}

function checkShutdown() {
  if (connections.size > 0) return;

  log("INFO", `No connections remaining, starting ${SHUTDOWN_GRACE_PERIOD_MS}ms grace period`);

  shutdownTimer = setTimeout(() => {
    // Re-check in case a new connection came in
    if (connections.size > 0) {
      log("INFO", "Shutdown aborted - new connections appeared");
      return;
    }

    log("INFO", "Grace period elapsed, shutting down");
    cleanup();
    process.exit(0);
  }, SHUTDOWN_GRACE_PERIOD_MS);
}

function getStatus(): StatusResponse {
  return {
    connections: connections.size,
    watching: watcherSubscription !== null,
    lastEvent: lastWatcherEvent,
    uptime: Date.now() - startTime,
  };
}

// ============================================================================
// Cleanup
// ============================================================================

function cleanup() {
  log("INFO", "Cleaning up...");

  // Stop poll timer
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  // Stop watcher
  if (watcherSubscription) {
    watcherSubscription.unsubscribe().catch(() => {});
    watcherSubscription = null;
  }

  // Close IPC server
  if (ipcServer) {
    ipcServer.close();
    ipcServer = null;
  }

  // Remove PID file
  try {
    if (existsSync(SERVICE_PID_FILE)) {
      unlinkSync(SERVICE_PID_FILE);
    }
  } catch {
    // Ignore
  }

  log("INFO", "Cleanup complete");
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  log("INFO", "Starting agentlogs service");

  // Ensure base directory exists
  ensureDir(SERVICE_PID_FILE);

  // Write PID file
  writeFileSync(SERVICE_PID_FILE, process.pid.toString());
  log("INFO", `PID file written: ${SERVICE_PID_FILE}`, { pid: process.pid });

  // Start IPC server
  ipcServer = createIPCServer({
    onConnect,
    onDisconnect,
    onStatus: getStatus,
    onShutdown: () => {
      log("INFO", "Shutdown requested via IPC");
      cleanup();
      process.exit(0);
    },
  });
  log("INFO", "IPC server started");

  // Scan for existing sessions
  scanExistingSessions();

  // Start Parcel Watcher on Codex sessions directory
  if (existsSync(CODEX_SESSIONS_DIR)) {
    try {
      watcherSubscription = await subscribe(CODEX_SESSIONS_DIR, (err, events) => {
        if (err) {
          log("ERROR", "Watcher error", { error: err.message });
          return;
        }

        for (const event of events) {
          log("DEBUG", `Watcher event: ${event.type}`, { path: event.path });

          if (event.type === "create" && event.path.endsWith(".jsonl")) {
            // New session file - add to tracking
            trackSession(event.path, true);
            logWatcherEvent({ type: "create", path: event.path });
          } else if (event.type === "update" && event.path.endsWith(".jsonl")) {
            // File was closed/flushed - check for turn completion
            logWatcherEvent({ type: "update", path: event.path, reason: "file_closed" });
            checkSessionForTurnComplete(event.path);
          } else if (event.type === "delete" && event.path.endsWith(".jsonl")) {
            // File deleted - remove from tracking
            trackedSessions.delete(event.path);
            logWatcherEvent({ type: "delete", path: event.path });
          }
        }
      });
      log("INFO", `Watching ${CODEX_SESSIONS_DIR}`);
    } catch (err) {
      log("ERROR", "Failed to start watcher", { error: err instanceof Error ? err.message : String(err) });
    }
  } else {
    log("WARN", `Codex sessions directory not found: ${CODEX_SESSIONS_DIR}`);
  }

  // Start polling for mtime/token_count changes
  pollTimer = setInterval(pollSessions, POLL_INTERVAL_MS);
  log("INFO", `Polling sessions every ${POLL_INTERVAL_MS}ms`);

  // Handle signals
  process.on("SIGTERM", () => {
    log("INFO", "Received SIGTERM");
    cleanup();
    process.exit(0);
  });

  process.on("SIGINT", () => {
    log("INFO", "Received SIGINT");
    cleanup();
    process.exit(0);
  });

  // Start grace period timer (will shut down if no connections within grace period)
  checkShutdown();

  log("INFO", "Service ready");
}

main().catch((err) => {
  log("ERROR", "Service failed to start", { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
