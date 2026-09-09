// Run each integration scenario in its own process: settings and discovery
// cache the user directory at import time. Only storage location and pricing
// are replaced; permission checks, conversion, commands and HTTP uploads are real.
import { mock } from "bun:test";
import * as os from "os";
import type { TranscriptSource } from "@agentlogs/shared";

const scenario = JSON.parse(process.argv[2]) as {
  userDir: string;
  mode: "single" | "all" | "hook" | "latest" | "sync";
  source: TranscriptSource;
  transcriptPath: string;
  sessionId: string;
  cwd: string;
  repoFilter?: string;
};
mock.module("os", () => ({ ...os, homedir: () => scenario.userDir }));
const { LiteLLMPricingFetcher } = await import("@agentlogs/shared/pricing");
LiteLLMPricingFetcher.prototype.fetchModelPricing = async () => new Map();

if (scenario.mode === "latest") {
  const { interactiveUploadCommand } = await import("../../commands/upload");
  await interactiveUploadCommand(undefined, { source: scenario.source, latest: true });
} else if (scenario.mode === "sync") {
  const { syncCommand } = await import("../../commands/claudecode/sync");
  await syncCommand({ repoFilter: scenario.repoFilter });
} else if (scenario.mode === "hook") {
  if (scenario.source === "codex") {
    const { hookCommand } = await import("../../commands/codex/hook");
    await hookCommand();
  } else {
    const { hookCommand } = await import("../../commands/claudecode/hook");
    await hookCommand();
  }
} else {
  const { performUpload, performUploadToAllEnvs } = await import("../perform-upload");
  const params = {
    transcriptPath: scenario.transcriptPath,
    sessionId: scenario.sessionId,
    source: scenario.source,
    cwdOverride: scenario.cwd,
  };
  const result =
    scenario.mode === "single"
      ? await performUpload(params, { serverUrl: process.env.AGENTLOGS_SERVER_URL, authToken: "integration-test" })
      : await performUploadToAllEnvs(params);
  process.stdout.write(JSON.stringify(result));
}
