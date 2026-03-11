import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";
import { createDrizzle } from "../../db";
import * as queries from "../../db/queries";
import { session, user } from "../../db/schema";
import { env } from "../../lib/env";

export const Route = createFileRoute("/api/auth/token")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!env.GITLAB_CLIENT_ID || !env.GITLAB_CLIENT_SECRET) {
          return new Response(JSON.stringify({ error: "token exchange is not enabled on this server" }), { status: 404 });
        }

        const { token } = (await request.json()) as { token?: string };
        if (!token) {
          return new Response(JSON.stringify({ error: "token required" }), { status: 400 });
        }

        // Verify token via the configured OIDC provider's userinfo endpoint
        const providerResp = await fetch(`${env.GITLAB_ISSUER}/api/v4/user`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!providerResp.ok) {
          return new Response(JSON.stringify({ error: "invalid token" }), { status: 401 });
        }
        const profile = (await providerResp.json()) as {
          id: number;
          username: string;
          email: string;
          name: string;
          avatar_url?: string;
        };

        if (!profile.email) {
          return new Response(JSON.stringify({ error: "no email in provider profile" }), { status: 400 });
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
          const userCount = await queries.getUserCount(db);
          const role = userCount === 0 ? "admin" : env.WAITLIST_ENABLED ? "waitlist" : "user";

          const newUsers = await db
            .insert(user)
            .values({
              id: crypto.randomUUID(),
              name: profile.name || profile.username,
              username: profile.username.toLowerCase(),
              email: profile.email,
              emailVerified: true,
              image: profile.avatar_url || null,
              role,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .returning();
          existingUser = newUsers[0];
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
