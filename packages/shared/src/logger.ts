import { appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { getDevLogPath } from "./paths";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

interface LoggerOptions {
  component: string;
  logToFile?: boolean;
  logFilePath?: string;
  disableConsole?: boolean;
}

// Track if we've shown the payload logging message (once per process)
let hasShownPayloadMessage = false;

/**
 * Sanitize metadata for logging - prevents binary data and huge payloads
 */
function sanitizeMeta(meta: unknown): unknown {
  if (meta === undefined || meta === null) return meta;

  // Check if payload logging is disabled
  const skipPayloads = process.env.DEBUG_PAYLOADS !== "true";
  if (skipPayloads) {
    // Return message only once per process
    if (!hasShownPayloadMessage) {
      hasShownPayloadMessage = true;
      return "[payload logging disabled - set DEBUG_PAYLOADS=true to enable]";
    }
    return undefined;
  }

  // Recursively sanitize objects/arrays
  if (typeof meta === "object") {
    const json = JSON.stringify(meta);
    const sizeKB = Math.round(json.length / 1024);

    // Check for binary data indicators
    const hasBinary =
      json.includes('"isImage":true') ||
      json.includes('"isImage": true') ||
      (json.length > 10000 && /[A-Za-z0-9+/]{100,}/.test(json));

    // If too large or has binary, return summary
    if (hasBinary || json.length > 10000) {
      return `[payload: ${sizeKB}KB${hasBinary ? ", contains binary data" : ""}]`;
    }
  }

  return meta;
}

/**
 * Simple, elegant logger that writes to both console and file
 *
 * Features:
 * - Dual output: stdout + file (in development)
 * - Structured format: [timestamp] [component] [level] message
 * - Auto-creates logs directory
 * - Thread-safe file appends
 * - Zero dependencies (Node.js fs only)
 *
 * Usage:
 *   const logger = createLogger("server");
 *   logger.info("Server starting");
 *   logger.error("Upload failed", { sessionId: "abc" });
 */
class Logger {
  private component: string;
  private logToFile: boolean;
  private logFilePath: string;
  private disableConsole: boolean;

  constructor(options: LoggerOptions) {
    this.component = options.component;
    this.disableConsole = options.disableConsole ?? false;

    // Detect if we're in a Node.js environment (not Cloudflare Workers or browser)
    const isNodeEnvironment = typeof process !== "undefined" && !!process.versions?.node;

    // Only log to file in Node.js development (not in production/test/Workers/browser)
    this.logToFile =
      options.logToFile ??
      (isNodeEnvironment && process.env.NODE_ENV !== "production" && process.env.NODE_ENV !== "test");

    // Default: logs/dev.log in monorepo root
    // Only compute path if we're in Node.js and going to use it
    if (isNodeEnvironment && this.logToFile) {
      const defaultPath = getDevLogPath();
      const resolvedPath = options.logFilePath ?? defaultPath;
      if (resolvedPath) {
        this.logFilePath = resolvedPath;
      } else {
        // No repo root found (e.g., prod CLI, Cloudflare Workers) - disable file logging
        this.logToFile = false;
        this.logFilePath = "";
      }
    } else {
      this.logFilePath = "";
      this.logToFile = false;
    }

    // Debug: log configuration on first instantiation
    if (process.env.DEBUG) {
      console.log(`[${this.component}] Logger config:`, {
        logToFile: this.logToFile,
        logFilePath: this.logFilePath,
        cwd: process.cwd(),
        NODE_ENV: process.env.NODE_ENV,
      });
    }

    // Ensure logs directory exists
    if (this.logToFile) {
      try {
        const logsDir = dirname(this.logFilePath);
        mkdirSync(logsDir, { recursive: true });
      } catch (err) {
        // Log error to console if DEBUG is set
        if (process.env.DEBUG) {
          console.error(`[${this.component}] Failed to create logs directory:`, err);
        }
      }
    }
  }

  private log(level: LogLevel, message: string, meta?: any) {
    // Format: [MM-DD HH:MM:SS] [component] [level] message
    const now = new Date();
    const timestamp = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:${String(now.getSeconds()).padStart(2, "0")}`;
    const logLine = `[${timestamp}] [${this.component}] [${level}] ${message}`;

    // Console output (always, regardless of environment)
    const consoleMethod = level === "ERROR" ? console.error : level === "WARN" ? console.warn : console.log;

    // Sanitize metadata before logging
    const sanitizedMeta = sanitizeMeta(meta);

    if (!this.disableConsole) {
      consoleMethod(logLine);

      // Meta data on separate line (indented for readability)
      if (sanitizedMeta !== undefined) {
        const metaStr =
          typeof sanitizedMeta === "object" ? JSON.stringify(sanitizedMeta, null, 2) : String(sanitizedMeta);
        consoleMethod(`  ${metaStr}`);
      }
    }

    // File output (development only)
    if (this.logToFile) {
      try {
        let fileContent = logLine + "\n";
        if (sanitizedMeta !== undefined) {
          const metaStr = typeof sanitizedMeta === "object" ? JSON.stringify(sanitizedMeta) : String(sanitizedMeta);
          fileContent += `  ${metaStr}\n`;
        }
        appendFileSync(this.logFilePath, fileContent);
      } catch {
        // Silently fail file writes (don't crash app if disk full, etc.)
      }
    }
  }

  /**
   * Debug-level log (only in development or when DEBUG env var is set)
   */
  debug(message: string, meta?: any) {
    if (process.env.NODE_ENV !== "production" || process.env.DEBUG) {
      this.log("DEBUG", message, meta);
    }
  }

  /**
   * Info-level log (general information)
   */
  info(message: string, meta?: any) {
    this.log("INFO", message, meta);
  }

  /**
   * Warning-level log (non-critical issues)
   */
  warn(message: string, meta?: any) {
    this.log("WARN", message, meta);
  }

  /**
   * Error-level log (critical issues)
   */
  error(message: string, meta?: any) {
    this.log("ERROR", message, meta);
  }
}

/**
 * Factory function to create a logger instance for a component
 *
 * @param component - Component name (e.g., "server", "plugin", "cli")
 * @param options - Optional logger configuration (logToFile, logFilePath)
 * @returns Logger instance
 *
 * @example
 *   const logger = createLogger("server");
 *   logger.info("Server started on port 8787");
 *   logger.error("Database connection failed", { error: err });
 *
 *   // With explicit log path
 *   const cliLogger = createLogger("cli", { logFilePath: "/path/to/dev.log" });
 */
export function createLogger(component: string, options?: Partial<Omit<LoggerOptions, "component">>): Logger {
  return new Logger({ component, ...options });
}
