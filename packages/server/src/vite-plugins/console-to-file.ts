import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";

// Get paths without importing from shared package (to avoid TS import issues in vite config)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const getRepoRoot = () => resolve(__dirname, "../../../..");
const getLogsDir = () => resolve(getRepoRoot(), "logs");
const getDevLogPath = () => resolve(getLogsDir(), "dev.log");

/**
 * Strips ANSI color codes from strings
 */
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex -- ANSI escape codes require control characters
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/**
 * Strips Vite's built-in timestamps from log messages
 * Examples: "10:59:41 [vite] message" -> "[vite] message"
 */
function stripViteTimestamp(str: string): string {
  // Remove HH:MM:SS timestamp at start of line (Vite's format)
  return str.replace(/^\d{1,2}:\d{2}:\d{2}\s+/, "");
}

/**
 * Creates a deduplication handler to prevent duplicate log entries
 * (especially useful for SSR contexts where logs may be duplicated)
 */
function createLogDeduplicator() {
  const recentLogs = new Map<string, number>();
  const DEDUPE_WINDOW_MS = 100; // Consider logs within 100ms as duplicates

  return {
    /**
     * Checks if a log message is a duplicate within the time window
     * @returns true if duplicate (should skip), false if unique (should log)
     */
    isDuplicate(level: string, message: string): boolean {
      const logKey = `${level}:${message}`;
      const lastSeen = recentLogs.get(logKey);
      const currentTime = Date.now();

      if (lastSeen && currentTime - lastSeen < DEDUPE_WINDOW_MS) {
        return true; // Skip duplicate within time window
      }

      // Update last seen time
      recentLogs.set(logKey, currentTime);

      // Clean up old entries (keep map size bounded)
      if (recentLogs.size > 100) {
        const cutoff = currentTime - DEDUPE_WINDOW_MS * 2;
        for (const [key, time] of recentLogs.entries()) {
          if (time < cutoff) {
            recentLogs.delete(key);
          }
        }
      }

      return false;
    },
  };
}

/**
 * Formats a timestamp for log entries
 * Format: MM-DD HH:MM:SS (no year)
 */
function formatTimestamp(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
}

/**
 * Vite plugin to intercept console logs and write them to a file
 *
 * This plugin captures all console.log, console.error, and console.warn calls
 * and writes them to logs/dev.log in the monorepo root.
 *
 * Features:
 * - Automatic log file clearing on startup
 * - ANSI color code stripping
 * - Deduplication to prevent SSR-related duplicate logs
 * - Consistent timestamp format across all log entries
 */
export function consoleToFile() {
  const logFilePath = getDevLogPath();
  let initialized = false;

  return {
    name: "console-to-file",
    configResolved() {
      // Only run in development
      if (process.env.NODE_ENV === "production") return;

      if (!initialized) {
        initialized = true;

        // Ensure logs directory exists
        try {
          mkdirSync(getLogsDir(), { recursive: true });
        } catch {
          // Directory already exists or cannot be created
        }

        // Clear log file on startup
        try {
          writeFileSync(logFilePath, "");
        } catch {
          // Silently fail - don't crash if cannot clear file
        }

        // Intercept console methods
        const originalLog = console.log;
        const originalError = console.error;
        const originalWarn = console.warn;

        const deduplicator = createLogDeduplicator();

        const writeToFile = (level: string, ...args: any[]) => {
          try {
            const timestamp = formatTimestamp();
            let message = args
              .map((arg) => {
                if (typeof arg === "object") {
                  return JSON.stringify(arg);
                }
                return stripAnsi(String(arg));
              })
              .join(" ")
              .trim();

            // Skip empty messages
            if (!message) return;

            // Strip Vite's own timestamps to avoid duplication
            message = stripViteTimestamp(message);

            // Check for duplicates
            if (deduplicator.isDuplicate(level, message)) {
              return;
            }

            const logLine = `[${timestamp}] [server] [${level}] ${message}\n`;
            appendFileSync(logFilePath, logLine);
          } catch {
            // Silently fail - don't crash if disk full, etc.
          }
        };

        console.log = (...args: any[]) => {
          originalLog(...args);
          writeToFile("INFO", ...args);
        };

        console.error = (...args: any[]) => {
          originalError(...args);
          writeToFile("ERROR", ...args);
        };

        console.warn = (...args: any[]) => {
          originalWarn(...args);
          writeToFile("WARN", ...args);
        };
      }
    },
  };
}
