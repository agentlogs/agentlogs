import { installCodexHookIntegration } from "../../lib/codex-config";

const DEFAULT_HOOK_COMMAND = "npx -y agentlogs codex hook";

export async function codexInstallCommand(): Promise<void> {
  const result = installCodexHookIntegration(DEFAULT_HOOK_COMMAND);

  console.log("Installed AgentLogs Codex hooks.");
  console.log(`Config: ${result.paths.configPath}`);
  console.log(`Hooks: ${result.paths.hooksPath}`);

  if (!result.configUpdated && !result.hooksUpdated) {
    console.log("No changes were needed.");
  } else {
    if (result.configUpdated) {
      console.log("Enabled experimental Codex hooks via [features].codex_hooks = true.");
    }
    if (result.hooksUpdated) {
      console.log("Wrote AgentLogs SessionStart and Stop hook entries.");
    }
  }
}
