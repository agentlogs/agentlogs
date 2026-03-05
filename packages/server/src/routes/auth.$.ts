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
      },
    },
  },
});
