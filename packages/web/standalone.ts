import { embeddedClientAssets } from "./dist/embedded-client-assets";
import { embeddedMigrations } from "./dist/embedded-migrations";
import { createDrizzle, dbPath } from "./src/db/index";
import { logger } from "./src/lib/logger";

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 3000;
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const DEFAULT_CACHE_CONTROL = "public, max-age=3600";
const MIGRATIONS_FLAG = "--migrations";
const ONLY_MIGRATIONS_FLAG = "--only-migrations";
const STATIC_METHODS = new Set(["GET", "HEAD"]);
const staticFiles = new Map(
  Object.entries(embeddedClientAssets).map(([pathname, embeddedPath]) => [pathname, Bun.file(embeddedPath)]),
);

function getRuntimeFlags() {
  const args = new Set(process.argv.slice(2));
  const onlyMigrations = args.has(ONLY_MIGRATIONS_FLAG);

  return {
    onlyMigrations,
    runMigrations: onlyMigrations || args.has(MIGRATIONS_FLAG),
  };
}

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

function runEmbeddedMigrations(): void {
  const db = createDrizzle();
  db.dialect.migrate(embeddedMigrations, db.session, {});

  logger.info("Standalone migrations completed", {
    dbPath,
    migrationCount: embeddedMigrations.length,
  });
}

const runtimeFlags = getRuntimeFlags();

if (runtimeFlags.runMigrations) {
  try {
    runEmbeddedMigrations();
  } catch (error) {
    logger.error("Standalone migrations failed", {
      dbPath,
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }

  if (runtimeFlags.onlyMigrations) {
    logger.info("Standalone migration-only run complete", { dbPath });
    process.exit(0);
  }
}

const host = process.env.HOST || DEFAULT_HOST;
const port = Number.parseInt(process.env.PORT || String(DEFAULT_PORT), 10);

if (!Number.isFinite(port) || port <= 0) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

const { default: app } = await import("./dist/server/server.js");

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
