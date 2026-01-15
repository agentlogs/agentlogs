import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { RouterContract } from "./rpc-contract";

export interface CreateClientOptions {
  serverUrl: string;
  authToken?: string | null;
  timeoutMs?: number;
}

export function createRpcClient(options: CreateClientOptions): RouterContract {
  const { serverUrl, authToken, timeoutMs = 10_000 } = options;

  const link = new RPCLink({
    url: `${serverUrl}/rpc`,
    headers: () => ({
      ...(authToken && { Authorization: `Bearer ${authToken}` }),
    }),
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      }),
  });

  // The oRPC client is typed loosely here since RouterContract is our simplified interface
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createORPCClient<any>(link) as RouterContract;
}

export type RpcClient = RouterContract;
