import { createFileRoute } from "@tanstack/react-router";
import { createAuth } from "../../lib/auth";

// Catch-all route for BetterAuth endpoints (/api/auth/*)
export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const auth = createAuth();
        return auth.handler(request);
      },
      POST: async ({ request }) => {
        const auth = createAuth();
        return auth.handler(request);
      },
    },
  },
});
