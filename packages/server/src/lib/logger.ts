import { createLogger } from "@agentlogs/shared";

/**
 * Logger for the server package (server-side code)
 * Use this for all logging in API routes, server functions, and SSR code
 */
export const logger = createLogger("server");
