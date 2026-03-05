import { createFileRoute } from "@tanstack/react-router";
import { json } from "@tanstack/react-start";

const payload = {
  ok: true,
};

export const Route = createFileRoute("/healthz")({
  server: {
    handlers: {
      GET: async () => json(payload),
      HEAD: async () => new Response(null, { status: 200 }),
    },
  },
});
