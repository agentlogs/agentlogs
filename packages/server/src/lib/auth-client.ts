import { deviceAuthorizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: import.meta.env.PROD ? "https://agentlogs.ai" : "http://localhost:3000",
  plugins: [deviceAuthorizationClient()],
});

// Export hooks for convenient use in components
export const { useSession } = authClient;
