import { RPCHandler } from "@orpc/server/fetch";
import { createFileRoute } from "@tanstack/react-router";
import { router } from "../../lib/rpc/router";

const handler = new RPCHandler(router);

async function handleRequest({ request }: { request: Request }) {
  const { response } = await handler.handle(request, {
    prefix: "/rpc",
    context: { request },
  });

  return response ?? new Response("Not found", { status: 404 });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute("/rpc/$" as any)({
  server: {
    handlers: {
      GET: handleRequest,
      POST: handleRequest,
    },
  },
});
