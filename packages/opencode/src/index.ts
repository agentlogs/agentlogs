import { createAgentLogsPlugin } from "./lib/plugin";

// OpenCode 2 loads the default export as the plugin definition.
export default createAgentLogsPlugin().plugin;
