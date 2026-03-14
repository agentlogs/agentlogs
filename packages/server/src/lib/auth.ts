import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, deviceAuthorization, genericOAuth } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { eq } from "drizzle-orm";
import { env } from "@/lib/env";
import { createDrizzle } from "../db";
import { promoteToAdminIfFirst } from "../db/queries";
import { user } from "../db/schema";
import { logger } from "./logger";

function hasGithubAuth(): boolean {
  return Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

function hasGitlabAuth(): boolean {
  return Boolean(env.GITLAB_CLIENT_ID && env.GITLAB_CLIENT_SECRET);
}

export function getPrimaryAuthProvider(): "github" | "gitlab" | null {
  if (hasGithubAuth()) {
    return "github";
  }

  if (hasGitlabAuth()) {
    return "gitlab";
  }

  return null;
}

function buildAuth() {
  const db = createDrizzle(env.DB);

  const plugins = [
    bearer(),
    deviceAuthorization({ verificationUri: "/app/device" }),
    tanstackStartCookies(),
    ...(hasGitlabAuth()
      ? [
          genericOAuth({
            config: [
              {
                providerId: "gitlab",
                discoveryUrl: `${env.GITLAB_ISSUER}/.well-known/openid-configuration`,
                clientId: env.GITLAB_CLIENT_ID,
                clientSecret: env.GITLAB_CLIENT_SECRET,
                scopes: ["openid", "profile", "email"],
                mapProfileToUser: (profile) =>
                  ({
                    name: (profile.name as string) || (profile.username as string) || "",
                    username: (profile.username as string)?.toLowerCase() ?? "",
                  }) as Record<string, unknown>,
              },
            ],
          }),
        ]
      : []),
  ];

  const socialProviders: Parameters<typeof betterAuth>[0]["socialProviders"] = hasGithubAuth()
    ? {
        github: {
          clientId: env.GITHUB_CLIENT_ID,
          clientSecret: env.GITHUB_CLIENT_SECRET,
          mapProfileToUser: (profile) => ({
            username: profile.login.toLowerCase(),
          }),
        },
      }
    : {};

  return betterAuth({
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
    socialProviders,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.WEB_URL,
    trustedOrigins: [env.WEB_URL],
    plugins,
    databaseHooks: {
      user: {
        create: {
          after: async (newUser) => {
            // Try atomic admin promotion first (race-safe: only one concurrent
            // caller can win the NOT EXISTS check)
            const promoted = await promoteToAdminIfFirst(db, newUser.id);
            if (promoted) return;

            // Not the first user — apply waitlist policy
            if (!env.WAITLIST_ENABLED) {
              await db.update(user).set({ role: "user" }).where(eq(user.id, newUser.id));
            }
            // else: leave schema default "waitlist" in place
          },
        },
      },
    },
  });
}

export type Auth = ReturnType<typeof buildAuth>;

let authInstanceCache: Auth | null = null;

function assertAuthConfigured(): void {
  const missing: string[] = [];
  const hasGithub = hasGithubAuth();
  const hasGitlab = hasGitlabAuth();
  if (!hasGithub && !hasGitlab) {
    missing.push("GITHUB_CLIENT_ID+SECRET or GITLAB_CLIENT_ID+SECRET");
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
      hasGithubClientId: hasGithubAuth(),
      hasGitlabClientId: hasGitlabAuth(),
      hasBetterAuthSecret: Boolean(env.BETTER_AUTH_SECRET),
      hasWebUrl: Boolean(env.WEB_URL),
      webUrl: env.WEB_URL,
      cached: Boolean(authInstanceCache),
    });

    authInstanceCache = buildAuth();
    return authInstanceCache;
  } catch (error) {
    logger.error("Failed to create auth instance", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
