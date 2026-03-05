import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
  // Use local SQLite file credentials for Bun-first development tooling.
  dbCredentials: {
    url: process.env.DB_LOCAL_PATH || "file:.data/db.sqlite",
  },
});
