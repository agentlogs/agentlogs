import { mkdirSync } from "node:fs";
import path from "node:path";
import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { env } from "../lib/env";
import { logger } from "../lib/logger";
import * as schema from "./schema";

function resolveDbPath(rawPath: string): string {
  const withoutPrefix = rawPath.startsWith("file:") ? rawPath.slice(5) : rawPath;
  return path.resolve(process.cwd(), withoutPrefix);
}

const dbPath = resolveDbPath(env.DB);
mkdirSync(path.dirname(dbPath), { recursive: true });
const sqlite = new Database(dbPath, { create: true });

sqlite.run("PRAGMA journal_mode = WAL;");

export function createDrizzle(_db?: unknown) {
  const enableSqlLogging = process.env.DEBUG_SQL === "true";

  return drizzle({
    client: sqlite,
    schema,
    ...(enableSqlLogging && {
      logger: {
        logQuery(query: string, params: unknown[]) {
          logger.debug("SQL Query:", { query, params });
        },
      },
    }),
  });
}

export type DrizzleDB = ReturnType<typeof createDrizzle>;
