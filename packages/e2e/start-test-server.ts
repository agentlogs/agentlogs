/**
 * Starts the test server with a pre-seeded database.
 *
 * This script:
 * 1. Deletes the existing test database
 * 2. Applies migrations to create a fresh schema
 * 3. Seeds the database with test data
 * 4. Starts the vite dev server
 *
 * This ensures the database is seeded BEFORE vite reads it.
 */
import { Database } from "bun:sqlite";
import { $ } from "bun";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { spawn } from "child_process";
import * as schema from "../server/src/db/schema";
import path from "path";
import fs from "fs";
import { TEST_AUTH_SECRET } from "./utils/sign-cookie";

// Log file for server output - read by globalTeardown on failure
export const SERVER_LOG_FILE = path.join(import.meta.dirname!, ".server-output.log");

const SERVER_DIR = path.resolve(import.meta.dirname!, "../server");
const TEST_DB_LOCAL_PATH = "file:.data/test-db.sqlite";
const TEST_DB_PATH = path.join(SERVER_DIR, ".data/test-db.sqlite");
const TEST_SERVER_PORT = "3009";
const TEST_SERVER_URL = `http://localhost:${TEST_SERVER_PORT}`;
const TEST_GITHUB_CLIENT_ID = "e2e-github-client-id";
const TEST_GITHUB_CLIENT_SECRET = "e2e-github-client-secret";

function deleteExistingDatabase() {
  fs.mkdirSync(path.dirname(TEST_DB_PATH), { recursive: true });
  fs.rmSync(TEST_DB_PATH, { force: true });
}

async function applyMigrations() {
  await $`bun run db:migrate`.cwd(SERVER_DIR).env({
    ...process.env,
    CI: "true",
    DB_LOCAL_PATH: TEST_DB_LOCAL_PATH,
  });
}

function seedDatabase() {
  if (!fs.existsSync(TEST_DB_PATH)) {
    throw new Error(`[test-server] Database not found after migrations: ${TEST_DB_PATH}`);
  }

  const sqlite = new Database(TEST_DB_PATH);
  const db = drizzle(sqlite, { schema });

  // Seed test user with "user" role (not "waitlist") so they can access /app
  db.insert(schema.user)
    .values({
      id: "test-user-id",
      name: "Test User",
      username: "testuser",
      email: "test@example.com",
      emailVerified: true,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

  // Seed test session (for auth)
  db.insert(schema.session)
    .values({
      id: "test-session-id",
      userId: "test-user-id",
      token: "test-session-token",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

  // Seed second active user (non-owner for authz tests)
  db.insert(schema.user)
    .values({
      id: "other-user-id",
      name: "Other User",
      username: "otheruser",
      email: "other@example.com",
      emailVerified: true,
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

  db.insert(schema.session)
    .values({
      id: "other-session-id",
      userId: "other-user-id",
      token: "other-session-token",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

  // Seed waitlist user for access control tests
  db.insert(schema.user)
    .values({
      id: "waitlist-user-id",
      name: "Waitlist User",
      username: "waitlistuser",
      email: "waitlist@example.com",
      emailVerified: true,
      role: "waitlist",
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

  db.insert(schema.session)
    .values({
      id: "waitlist-session-id",
      userId: "waitlist-user-id",
      token: "waitlist-session-token",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      createdAt: new Date(),
      updatedAt: new Date(),
    })
    .run();

  // Seed transcript owned by test user for commit tracking authz checks
  db.insert(schema.transcripts)
    .values({
      id: "seed-transcript-id",
      userId: "test-user-id",
      visibility: "private",
      sha256: "a".repeat(64),
      transcriptId: "seed-transcript",
      source: "claude-code",
      createdAt: new Date(),
      costUsd: 0,
      blendedTokens: 0,
      messageCount: 1,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
      cwd: "/tmp",
    })
    .run();

  sqlite.close();
}

function startViteServer() {
  // Clear previous log file
  fs.writeFileSync(SERVER_LOG_FILE, "");

  // Open log file for appending
  const logStream = fs.createWriteStream(SERVER_LOG_FILE, { flags: "a" });

  // Start vite dev in the foreground on port 3009 (this will keep running)
  // Use --host to bind to all interfaces so subprocess fetch can connect
  // Capture output to log file for debugging on test failure
  const vite = spawn("bun", ["--bun", "vite", "dev", "--port", TEST_SERVER_PORT, "--host"], {
    cwd: SERVER_DIR,
    stdio: ["pipe", "pipe", "pipe"],
    env: {
      ...process.env,
      VITE_USE_TEST_DB: "true",
      DB_LOCAL_PATH: TEST_DB_LOCAL_PATH,
      BETTER_AUTH_SECRET: TEST_AUTH_SECRET,
      GITHUB_CLIENT_ID: TEST_GITHUB_CLIENT_ID,
      GITHUB_CLIENT_SECRET: TEST_GITHUB_CLIENT_SECRET,
      WEB_URL: TEST_SERVER_URL,
    },
  });

  // Write stdout and stderr to log file
  vite.stdout?.on("data", (data) => logStream.write(data));
  vite.stderr?.on("data", (data) => logStream.write(data));

  vite.on("close", (code) => {
    logStream.close();
    process.exit(code ?? 0);
  });
}

async function main() {
  deleteExistingDatabase();
  await applyMigrations();
  seedDatabase();
  startViteServer();
}

await main();
