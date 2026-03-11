import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { createDrizzle } from "../../db";
import { promoteToAdminIfFirst } from "../../db/queries";
import { session, user } from "../../db/schema";
import { env } from "../../lib/env";

interface NormalizedProfile {
  email: string;
  name: string;
  username: string;
  image: string | null;
}

interface OAuthProvider {
  id: string;
  userinfoUrl: string;
  normalizeProfile: (raw: Record<string, unknown>) => NormalizedProfile | null;
}

/** Returns the list of OAuth providers that are currently configured. */
function getConfiguredProviders(): OAuthProvider[] {
  const providers: OAuthProvider[] = [];

  if (env.GITLAB_CLIENT_ID && env.GITLAB_CLIENT_SECRET) {
    providers.push({
      id: "gitlab",
      userinfoUrl: `${env.GITLAB_ISSUER}/api/v4/user`,
      normalizeProfile: (raw) => {
        const email = (raw.email as string) || (raw.public_email as string);
        if (!email) return null;
        return {
          email,
          name: (raw.name as string) || (raw.username as string) || email,
          username: ((raw.username as string) || email).toLowerCase(),
          image: (raw.avatar_url as string) || null,
        };
      },
    });
  }

  if (env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) {
    providers.push({
      id: "github",
      userinfoUrl: "https://api.github.com/user",
      normalizeProfile: (raw) => {
        const email = raw.email as string;
        if (!email) return null;
        return {
          email,
          name: (raw.name as string) || (raw.login as string) || email,
          username: ((raw.login as string) || email).toLowerCase(),
          image: (raw.avatar_url as string) || null,
        };
      },
    });
  }

  return providers;
}

/** Try each configured provider's userinfo endpoint with the token. Returns the first match. */
async function resolveProfile(token: string): Promise<NormalizedProfile | null> {
  const providers = getConfiguredProviders();
  for (const provider of providers) {
    try {
      const resp = await fetch(provider.userinfoUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) continue;
      const raw = (await resp.json()) as Record<string, unknown>;
      const profile = provider.normalizeProfile(raw);
      if (profile) return profile;
    } catch {
      // provider unreachable — try next
    }
  }
  return null;
}

export const Route = createFileRoute("/api/auth/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (getConfiguredProviders().length === 0) {
          return new Response(JSON.stringify({ error: "token exchange is not enabled on this server" }), { status: 404 });
        }

        const { token } = (await request.json()) as { token?: string };
        if (!token) {
          return new Response(JSON.stringify({ error: "token required" }), { status: 400 });
        }

        const profile = await resolveProfile(token);
        if (!profile) {
          return new Response(JSON.stringify({ error: "invalid token" }), { status: 401 });
        }

        const db = createDrizzle(env.DB);

        // Find or create user
        let existingUser = await db
          .select()
          .from(user)
          .where(eq(user.email, profile.email))
          .limit(1)
          .then((r) => r[0]);

        if (!existingUser) {
          // Insert with default role first, then atomically promote to admin if
          // no admin exists yet (race-safe: concurrent first-time logins cannot
          // both win the NOT EXISTS check)
          const defaultRole = env.WAITLIST_ENABLED ? "waitlist" : "user";
          const newUsers = await db
            .insert(user)
            .values({
              id: crypto.randomUUID(),
              name: profile.name,
              username: profile.username,
              email: profile.email,
              emailVerified: true,
              image: profile.image,
              role: defaultRole,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();
          existingUser = newUsers[0];

          if (existingUser) {
            await promoteToAdminIfFirst(db, existingUser.id);
            // Re-fetch to get the potentially updated role
            existingUser = await db.select().from(user).where(eq(user.id, existingUser.id)).limit(1).then((r) => r[0]);
          }
        }

        if (!existingUser) {
          return new Response(JSON.stringify({ error: "failed to create user" }), { status: 500 });
        }

        // Create session directly in DB
        const sessionToken = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
        await db.insert(session).values({
          id: crypto.randomUUID(),
          token: sessionToken,
          userId: existingUser.id,
          expiresAt,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

        return new Response(
          JSON.stringify({
            token: sessionToken,
            user: {
              id: existingUser.id,
              email: existingUser.email,
              name: existingUser.name,
            },
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      },
    },
  },
});
