/**
 * Vite plugin for logging HTTP requests in development
 *
 * Logs API requests and errors to console, which are then captured
 * by the console-to-file plugin for unified logging.
 */
export function requestLogger() {
  return {
    name: "request-logger",
    configureServer(server: any) {
      server.middlewares.use((req: any, res: any, next: any) => {
        const start = Date.now();

        // Filter out static resources and source files
        const staticExtensions = [
          ".js",
          ".css",
          ".map",
          ".json",
          ".woff",
          ".woff2",
          ".ttf",
          ".eot",
          ".svg",
          ".png",
          ".jpg",
          ".jpeg",
          ".gif",
          ".ico",
          ".webp",
          ".ts",
          ".tsx",
        ];
        const isStatic = staticExtensions.some((ext) => req.url.includes(ext));
        const isViteHMR =
          req.url.includes("@vite") ||
          req.url.includes("@fs") ||
          req.url.includes("@id") ||
          req.url.includes("__vite") ||
          req.url.includes("@react-refresh");
        const isSourceFile = req.url.startsWith("/src/");

        // Only log API requests and errors
        const isAPI = req.url.startsWith("/api/");
        const shouldLog = isAPI;

        if (isStatic || isViteHMR || isSourceFile || !shouldLog) {
          // Still track for error logging
          const originalEnd = res.end;
          res.end = function (...args: any[]) {
            // Log errors even for filtered requests
            if (res.statusCode >= 400) {
              const duration = Date.now() - start;
              console.error(`${req.method} ${req.url} - ${res.statusCode} (${duration}ms)`);
            }
            originalEnd.apply(res, args);
          };
          next();
          return;
        }

        // Log the incoming request
        console.log(`${req.method} ${req.url}`);

        // Intercept response to log status code and duration
        const originalEnd = res.end;
        res.end = function (...args: any[]) {
          const duration = Date.now() - start;
          const statusCode = res.statusCode;

          // Use error logging for 4xx/5xx responses
          if (statusCode >= 400) {
            console.error(`${req.method} ${req.url} - ${statusCode} (${duration}ms)`);
          } else {
            console.log(`${req.method} ${req.url} - ${statusCode} (${duration}ms)`);
          }
          originalEnd.apply(res, args);
        };

        next();
      });
    },
  };
}
