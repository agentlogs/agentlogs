import { appendFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import type { ViteDevServer } from "vite";

// Get paths without importing from shared package (to avoid TS import issues in vite config)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const getRepoRoot = () => resolve(__dirname, "../../../..");
const getLogsDir = () => resolve(getRepoRoot(), "logs");
const getDevLogPath = () => resolve(getLogsDir(), "dev.log");

/**
 * Formats a timestamp for log entries (matches logger.ts format)
 */
function formatTimestamp(): string {
  const now = new Date();
  return `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
}

/**
 * Serializes metadata for file logging
 */
function serializeMeta(meta: any): string {
  if (meta === undefined || meta === null) return "";

  try {
    const str = typeof meta === "object" ? JSON.stringify(meta) : String(meta);
    return `  ${str}`;
  } catch {
    return "  [unserializable]";
  }
}

/**
 * Vite plugin to handle client-side logs via WebSocket
 *
 * Listens for 'client-log' messages from the browser and writes them
 * to the shared dev.log file with consistent formatting.
 */
export function websocketLogger() {
  let logFilePath: string;

  return {
    name: "websocket-logger",

    configResolved() {
      // Only run in development
      if (process.env.NODE_ENV === "production") return;

      try {
        logFilePath = getDevLogPath();
      } catch (error) {
        console.error("[websocket-logger] Could not initialize log path:", error);
      }
    },

    configureServer(server: ViteDevServer) {
      // Only run in development
      if (process.env.NODE_ENV === "production") return;
      if (!logFilePath) return;

      // Handle WebSocket messages
      server.ws.on("client-log", (data: any) => {
        try {
          const { level, message, meta, stack, url } = data;

          // Format: [MM-DD HH:MM:SS] [web-client] [level] message
          const timestamp = formatTimestamp();
          let logLine = `[${timestamp}] [web-client] [${level}] ${message}`;

          // Add URL context if available and not root
          if (url && url !== "/") {
            logLine += ` (${url})`;
          }

          logLine += "\n";

          // Add metadata if present
          if (meta) {
            logLine += serializeMeta(meta) + "\n";
          }

          // Add stack trace if present (errors)
          if (stack) {
            logLine += "  Stack trace:\n";
            // Indent each line of stack trace
            const indentedStack = stack
              .split("\n")
              .map((line: string) => `    ${line}`)
              .join("\n");
            logLine += indentedStack + "\n";
          }

          // Write to file (synchronous for simplicity)
          appendFileSync(logFilePath, logLine);
        } catch (error) {
          // Log plugin errors to console (won't create infinite loop)
          console.error("[websocket-logger] Failed to write client log:", error);
        }
      });

      // Optional: Log when clients connect (only if DEBUG is set)
      if (process.env.DEBUG) {
        server.ws.on("connection", () => {
          const timestamp = formatTimestamp();
          const logLine = `[${timestamp}] [web-client] [DEBUG] WebSocket client connected\n`;
          try {
            appendFileSync(logFilePath, logLine);
          } catch {
            // Silent fail
          }
        });
      }
    },
  };
}
