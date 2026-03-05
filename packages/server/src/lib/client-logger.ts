/**
 * Client-side logger for development that sends logs to server via Vite's HMR channel
 *
 * Features:
 * - Intercepts console.log/warn/error and sends to server
 * - Captures uncaught exceptions and promise rejections
 * - Queue buffering when disconnected
 * - Development-only (no-op in production)
 */

interface ClientLogMessage {
  level: "DEBUG" | "INFO" | "WARN" | "ERROR";
  message: string;
  meta?: unknown;
  stack?: string;
  timestamp: number;
  url: string;
}

type LogLevel = "INFO" | "WARN" | "ERROR";

class ClientLogger {
  private readonly maxQueueSize = 100;
  private readonly reconnectCheckInterval = 5000;
  private readonly visibilityReconnectDelay = 1000;

  private queue: ClientLogMessage[] = [];
  private isProcessingLog = false; // Reentrancy guard
  private isReconnecting = false; // Reconnection guard to prevent concurrent attempts
  private isConnected = false;
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null;
  private visibilityChangeHandler: (() => void) | null = null;
  private beforeUnloadHandler: (() => void) | null = null;

  // Store original console methods
  private readonly originalConsole = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  private constructor() {
    // Note: Constructor is private - use factory function for proper initialization check
    this.isConnected = true;
    this.patchConsole();
    this.setupErrorHandlers();
    this.setupUnloadHandler();
    this.setupReconnectionMonitoring();

    // Send initial connection message
    this.sendMessage({
      level: "DEBUG",
      message: "Client logger initialized",
      timestamp: Date.now(),
      url: window.location.href,
    });

    // Flush any queued logs from before initialization
    this.flushQueue();
  }

  /**
   * Factory method to create a ClientLogger instance
   * Returns null if HMR is not available (production/SSR)
   */
  static create(): ClientLogger | null {
    if (!import.meta.hot) {
      return null;
    }
    return new ClientLogger();
  }

  private sendMessage(message: ClientLogMessage): void {
    // Prevent infinite loops
    if (this.isProcessingLog) {
      this.queueMessage(message);
      return;
    }

    if (!this.isConnected || !import.meta.hot) {
      this.queueMessage(message);
      return;
    }

    try {
      this.isProcessingLog = true;
      import.meta.hot.send("client-log", message);
    } catch {
      // Send failed - mark as disconnected and queue
      this.isConnected = false;
      this.queueMessage(message);
    } finally {
      this.isProcessingLog = false;
    }
  }

  private queueMessage(message: ClientLogMessage): void {
    this.queue.push(message);
    // Drop oldest if queue is full
    if (this.queue.length > this.maxQueueSize) {
      this.queue.shift();
    }
  }

  private flushQueue(): void {
    const hmr = import.meta.hot;
    if (!this.isConnected || !hmr) {
      return;
    }

    while (this.queue.length > 0) {
      const message = this.queue[0];
      try {
        hmr.send("client-log", message);
        this.queue.shift(); // Only remove if successful
      } catch {
        // Failed to send - mark as disconnected and stop flushing
        this.isConnected = false;
        break;
      }
    }
  }

  private setupReconnectionMonitoring(): void {
    if (!import.meta.hot) return;

    // Monitor page visibility - when user returns, try to flush queue
    this.visibilityChangeHandler = () => {
      if (!document.hidden && !this.isConnected && this.queue.length > 0) {
        // Wait a bit for Vite's HMR to reconnect
        setTimeout(() => {
          this.attemptReconnect();
        }, this.visibilityReconnectDelay);
      }
    };
    document.addEventListener("visibilitychange", this.visibilityChangeHandler);

    // Periodic health check: if queue is growing, verify connection
    this.healthCheckInterval = setInterval(() => {
      if (this.queue.length > 10 && this.isConnected) {
        this.attemptReconnect();
      }
    }, this.reconnectCheckInterval);
  }

  private attemptReconnect(): void {
    if (!import.meta.hot) return;

    // Guard against concurrent reconnection attempts
    if (this.isReconnecting) {
      return;
    }

    this.isReconnecting = true;

    try {
      // Try to send a test message
      import.meta.hot.send("client-log", {
        level: "DEBUG",
        message: "Reconnection attempt",
        timestamp: Date.now(),
        url: window.location.pathname,
      });
      // Success - mark as connected and flush queue
      this.isConnected = true;
      this.flushQueue();
    } catch {
      // Still disconnected
      this.isConnected = false;
    } finally {
      this.isReconnecting = false;
    }
  }

  private patchConsole(): void {
    console.log = (...args: unknown[]) => {
      this.originalConsole.log(...args);
      if (!this.isProcessingLog) {
        this.logToServer("INFO", args);
      }
    };

    console.warn = (...args: unknown[]) => {
      this.originalConsole.warn(...args);
      if (!this.isProcessingLog) {
        this.logToServer("WARN", args);
      }
    };

    console.error = (...args: unknown[]) => {
      this.originalConsole.error(...args);
      if (!this.isProcessingLog) {
        this.logToServer("ERROR", args);
      }
    };
  }

  private logToServer(level: LogLevel, args: unknown[]): void {
    // Reentrancy guard - prevents infinite loops
    if (this.isProcessingLog) {
      return;
    }

    const message = args
      .map((arg) => {
        if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}`;
        }
        if (typeof arg === "object" && arg !== null) {
          return "[object]"; // Don't stringify here, use meta
        }
        return String(arg);
      })
      .join(" ");

    const meta = args.length > 1 || typeof args[0] === "object" ? this.serializeMeta(args) : undefined;
    const stack = args.find((arg): arg is Error => arg instanceof Error)?.stack;

    this.sendMessage({
      level,
      message,
      meta,
      stack,
      timestamp: Date.now(),
      url: window.location.pathname,
    });
  }

  private serializeMeta(args: unknown[]): unknown {
    try {
      return JSON.parse(JSON.stringify(args));
    } catch {
      return { _serialization_failed: true, count: args.length };
    }
  }

  private setupErrorHandlers(): void {
    // Uncaught exceptions
    window.addEventListener("error", (event) => {
      if (this.isProcessingLog) return;

      const { message, filename, lineno, colno, error } = event;

      this.sendMessage({
        level: "ERROR",
        message: `Uncaught error: ${message}`,
        meta: {
          filename,
          lineno,
          colno,
        },
        stack: error?.stack || new Error().stack,
        timestamp: Date.now(),
        url: window.location.pathname,
      });
    });

    // Unhandled promise rejections
    window.addEventListener("unhandledrejection", (event) => {
      if (this.isProcessingLog) return;

      const { reason } = event;
      const message = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);

      this.sendMessage({
        level: "ERROR",
        message: `Unhandled promise rejection: ${message}`,
        stack: reason instanceof Error ? reason.stack : new Error().stack,
        timestamp: Date.now(),
        url: window.location.pathname,
      });
    });
  }

  private setupUnloadHandler(): void {
    this.beforeUnloadHandler = () => {
      // Best-effort attempt to flush remaining logs
      if (this.queue.length > 0 && this.isConnected) {
        this.flushQueue();
      }
      if (this.healthCheckInterval) {
        clearInterval(this.healthCheckInterval);
      }
    };
    window.addEventListener("beforeunload", this.beforeUnloadHandler);
  }

  destroy(): void {
    // Restore original console methods
    console.log = this.originalConsole.log;
    console.warn = this.originalConsole.warn;
    console.error = this.originalConsole.error;

    // Clear interval timer
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }

    // Remove event listeners
    if (this.visibilityChangeHandler) {
      document.removeEventListener("visibilitychange", this.visibilityChangeHandler);
      this.visibilityChangeHandler = null;
    }

    if (this.beforeUnloadHandler) {
      window.removeEventListener("beforeunload", this.beforeUnloadHandler);
      this.beforeUnloadHandler = null;
    }
  }
}

// Singleton instance (development only)
let loggerInstance: ClientLogger | null = null;

/**
 * Initialize the client logger (call once in root component)
 * Only runs in development mode
 */
export function initializeClientLogger(): void {
  if (import.meta.env.DEV && !loggerInstance) {
    loggerInstance = ClientLogger.create();
  }
}

/**
 * Get the logger instance (for manual logging if needed)
 */
export function getClientLogger(): ClientLogger | null {
  return loggerInstance;
}
