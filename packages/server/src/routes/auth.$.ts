import { createFileRoute, redirect } from "@tanstack/react-router";
import { createAuth } from "../lib/auth";

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

        // genericOAuth providers (e.g. gitlab) — forward to BetterAuth genericOAuth handler
        const forwardHeaders = new Headers(request.headers);
        forwardHeaders.set("Content-Type", "application/json");
        const betterAuthReq = new Request(new URL("/api/auth/sign-in/generic-oauth", request.url), {
          method: "POST",
          headers: forwardHeaders,
          body: JSON.stringify({ providerId: provider, callbackURL }),
        });
        return auth.handler(betterAuthReq);
      },
    },
  },
});
