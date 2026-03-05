import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { env } from "@/lib/env";
import { createDrizzle } from "../db";
import { logger } from "./logger";

let authInstanceCache: ReturnType<typeof betterAuth> | null = null;

function assertAuthConfigured(): void {
  const missing: string[] = [];
  if (!env.GITHUB_CLIENT_ID) {
    missing.push("GITHUB_CLIENT_ID");
  }
  if (!env.GITHUB_CLIENT_SECRET) {
    missing.push("GITHUB_CLIENT_SECRET");
  }
  if (!env.BETTER_AUTH_SECRET) {
    missing.push("BETTER_AUTH_SECRET");
  }
  if (!env.WEB_URL) {
    missing.push("WEB_URL");
  }

  if (missing.length > 0) {
    throw new Error(`BetterAuth misconfigured. Missing required env vars: ${missing.join(", ")}`);
  }
}

/**
 * Creates or returns a cached BetterAuth instance.
 */
export function createAuth() {
  try {
    assertAuthConfigured();

    if (authInstanceCache) {
      return authInstanceCache;
    }

    logger.debug("Creating auth instance", {
      hasDB: Boolean(env.DB),
      hasGithubClientId: Boolean(env.GITHUB_CLIENT_ID),
      hasGithubClientSecret: Boolean(env.GITHUB_CLIENT_SECRET),
      hasBetterAuthSecret: Boolean(env.BETTER_AUTH_SECRET),
      hasWebUrl: Boolean(env.WEB_URL),
      webUrl: env.WEB_URL,
      cached: Boolean(authInstanceCache),
    });

    const db = createDrizzle(env.DB);

    authInstanceCache = betterAuth({
      database: drizzleAdapter(db, {
        provider: "sqlite",
      }),
      user: {
        additionalFields: {
          username: {
            type: "string",
            required: false,
          },
        },
      },
      socialProviders: {
        github: {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          mapProfileToUser: (profile) => ({
            username: profile.login.toLowerCase(),
          }),
        },
      },
      secret: env.BETTER_AUTH_SECRET,
      baseURL: env.WEB_URL,
      trustedOrigins: [env.WEB_URL],
      plugins: [
        bearer(),
        deviceAuthorization({
          verificationUri: "/app/device",
        }),
        tanstackStartCookies(),
      ],
    });
    return authInstanceCache;
  } catch (error) {
    logger.error("Failed to create auth instance", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}

export type Auth = ReturnType<typeof createAuth>;
