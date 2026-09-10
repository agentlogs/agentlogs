import { createAgentLogsPlugin } from "./lib/plugin";

// OpenCode treats each distinct entrypoint export as a plugin instance.
export const agentLogsPlugin = createAgentLogsPlugin();
export default agentLogsPlugin;
