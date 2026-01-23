import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";
import { createDrizzle } from "../db";
import { user } from "../db/schema";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

/**
 * Development-only login route that bypasses OAuth
 *
 * Usage: /auth/dev-login?email=test@example.com
 *
 * SECURITY: Only works when DEV_AUTH_ENABLED=true in environment
 * This should NEVER be enabled in production
 *
 * Sets a dev-user-email cookie that getSession() checks to bypass real auth.
 */
export const Route = createFileRoute("/auth/dev-login")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Safety check: Only allow in development
        const devAuthEnabled = env.DEV_AUTH_ENABLED === "true";
        const isLocalhost = env.WEB_URL?.includes("localhost");

        if (!devAuthEnabled) {
          logger.warn("Dev login attempted but DEV_AUTH_ENABLED is not set");
          return new Response("Dev login is disabled. Set DEV_AUTH_ENABLED=true in .dev.vars", {
            status: 403,
          });
        }

        if (!isLocalhost) {
          logger.warn("Dev login attempted on non-localhost URL", { url: env.WEB_URL });
          return new Response("Dev login only works on localhost", { status: 403 });
        }

        const url = new URL(request.url);
        const email = url.searchParams.get("email");

        if (!email) {
          return new Response(
            "Usage: /auth/dev-login?email=test@example.com\n\n" +
              "This will set a cookie that bypasses auth for development.\n" +
              "The user must exist in the database.",
            { status: 400, headers: { "Content-Type": "text/plain" } },
          );
        }

        logger.warn("🚨 DEV LOGIN USED - This should never happen in production!", { email });

        try {
          const db = createDrizzle(env.DB);

          // Find user
          const users = await db.select().from(user).where(eq(user.email, email)).limit(1);
          let targetUser = users[0];

          // Create user if doesn't exist
          if (!targetUser) {
            const newUserId = crypto.randomUUID();
            await db.insert(user).values({
              id: newUserId,
              email: email,
              name: email.split("@")[0],
              emailVerified: true,
              role: "user",
            });
            const newUsers = await db.select().from(user).where(eq(user.id, newUserId)).limit(1);
            targetUser = newUsers[0];
            logger.info("Created new user for dev login", { email, userId: newUserId });
          }

          if (!targetUser) {
            return new Response("Failed to find or create user", { status: 500 });
          }

          logger.info("Dev login successful", {
            userId: targetUser.id,
            email: targetUser.email,
            name: targetUser.name,
          });

          // Set dev-user-email cookie and redirect to app
          const headers = new Headers();
          headers.set("Location", "/app");
          headers.set(
            "Set-Cookie",
            `dev-user-email=${encodeURIComponent(email)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 24 * 60 * 60}`,
          );

          return new Response(null, {
            status: 302,
            headers,
          });
        } catch (error) {
          logger.error("Dev login failed", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
          });
          return new Response(`Dev login failed: ${error}`, { status: 500 });
        }
      },
    },
  },
});
