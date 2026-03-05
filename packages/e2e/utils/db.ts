import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../server/src/db/schema";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.resolve(import.meta.dirname!, "../../server/.data/test-db.sqlite");

/**
 * Get a direct connection to the test SQLite database.
 * Remember to call sqlite.close() when done!
 */
export function getTestDb() {
  if (!fs.existsSync(TEST_DB_PATH)) {
    throw new Error(
      `Test database not found at ${TEST_DB_PATH}. ` +
        "Make sure the dev server has been started at least once with VITE_USE_TEST_DB=true",
    );
  }

  const sqlite = new Database(TEST_DB_PATH);
  return {
    db: drizzle(sqlite, { schema }),
    sqlite,
    schema,
  };
}

export { schema };
