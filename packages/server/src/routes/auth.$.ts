import { createFileRoute, redirect } from "@tanstack/react-router";
import { createAuth, getPrimaryAuthProvider } from "../lib/auth";

// Server-side OAuth redirect route: /auth/github
export const Route = createFileRoute("/auth/$")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const provider = params._splat;
        if (!provider) {
          throw redirect({ to: "/" });
        }

        // Allow callbackURL from query params, default to /app
        const url = new URL(request.url);
        const callbackURL = url.searchParams.get("callbackURL") ?? "/app";
        if (provider === "login") {
          const primaryProvider = getPrimaryAuthProvider();
          if (!primaryProvider) {
            throw redirect({ to: "/" });
          }

          throw redirect({ href: `/auth/${primaryProvider}?callbackURL=${encodeURIComponent(callbackURL)}` });
        }

        const auth = createAuth();

        if (provider === "github") {
          const result = await auth.api.signInSocial({
            body: { provider, callbackURL },
            headers: request.headers,
            returnHeaders: true,
          });

          if (!result.response?.url) {
            throw redirect({ to: "/" });
          }

          return new Response(null, {
            status: 302,
            headers: {
              ...Object.fromEntries(result.headers?.entries() ?? []),
              Location: result.response.url,
            },
          });
        }

        // genericOAuth providers (e.g. gitlab) — use BetterAuth API directly
        const result = await auth.api.signInWithOAuth2({
          body: { providerId: provider, callbackURL },
          headers: request.headers,
          returnHeaders: true,
        });

        const redirectUrl = result.response?.url;
        if (!redirectUrl) {
          throw redirect({ to: "/" });
        }

        return new Response(null, {
          status: 302,
          headers: {
            ...Object.fromEntries(result.headers?.entries() ?? []),
            Location: redirectUrl,
          },
        });
      },
    },
  },
});
