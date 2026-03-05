import app from "./dist/server/server.js";
import { embeddedClientAssets } from "./dist/embedded-client-assets";
import { logger } from "./src/lib/logger";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const DEFAULT_CACHE_CONTROL = "public, max-age=3600";
const STATIC_METHODS = new Set(["GET", "HEAD"]);
const staticFiles = new Map(
  Object.entries(embeddedClientAssets).map(([pathname, embeddedPath]) => [pathname, Bun.file(embeddedPath)]),
);

function getCacheControl(pathname: string): string {
  if (pathname.startsWith("/assets/") || /-[A-Za-z0-9_-]{8,}\.[^/]+$/.test(pathname)) {
    return IMMUTABLE_CACHE_CONTROL;
  }
  return DEFAULT_CACHE_CONTROL;
}

function serveStatic(request: Request): Response | null {
  if (!STATIC_METHODS.has(request.method)) {
    return null;
  }

  const pathname = new URL(request.url).pathname;
  const file = staticFiles.get(pathname);
  if (!file) {
    return null;
  }

  const headers = new Headers();
  const contentType = file.type;
  if (contentType) {
    headers.set("Content-Type", contentType);
  }
  headers.set("Cache-Control", getCacheControl(pathname));

  if (request.method === "HEAD") {
    headers.set("Content-Length", String(file.size));
    return new Response(null, { status: 200, headers });
  }

  return new Response(file, { status: 200, headers });
}

const host = process.env.HOST || DEFAULT_HOST;
const port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

const server = Bun.serve({
  hostname: host,
  port,
  fetch(request) {
    const staticResponse = serveStatic(request);
    if (staticResponse) {
      return staticResponse;
    }
    return app.fetch(request);
  },
  error(error) {
    logger.error("Unhandled Bun server error", {
      error: error instanceof Error ? error.message : String(error),
    });
    return new Response("Internal Server Error", { status: 500 });
  },
});

logger.info("Bun standalone server started", {
  host: server.hostname,
  port: server.port,
  embeddedAssetCount: Object.keys(embeddedClientAssets).length,
});
