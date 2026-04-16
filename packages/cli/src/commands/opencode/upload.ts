import { readFileSync, unlinkSync, openSync, closeSync } from "fs";
import * as os from "os";
import spawn from "cross-spawn";
import type { OpenCodeExport } from "@agentlogs/shared";
import { convertOpenCodeTranscript } from "@agentlogs/shared/opencode";
import { LiteLLMPricingFetcher } from "@agentlogs/shared/pricing";
import { resolveGitContext } from "@agentlogs/shared/claudecode";
import { uploadUnifiedToAllEnvs } from "../../lib/perform-upload";

interface SessionReadResult {
  success: boolean;
  data?: OpenCodeExport;
  error?: string;
}

/**
 * Read a session using OpenCode's export command.
 * This abstracts away the storage backend (JSON files or SQLite).
 *
 * Uses spawn with stdout redirected to a file descriptor to bypass the ~256KB
 * pipe buffer truncation bug that occurs when both stdout and stderr are piped.
 * This works in both Bun and Node.js runtimes.
 *
 * @see https://github.com/oven-sh/bun/issues/28145
 */
export async function readSessionFromExport(sessionId: string): Promise<SessionReadResult> {
  const tmpFile = `${os.tmpdir()}/agentlogs-oc-${process.pid}-${Date.now()}.json`;
  let exitCode = 0;
  let stderr = "";

  const fd = openSync(tmpFile, "w");

  try {
    const proc = spawn("opencode", ["export", sessionId], {
      stdio: ["pipe", fd, "pipe"],
    });

    if (proc.stderr) {
      proc.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    exitCode = await new Promise<number>((resolve) => proc.on("close", resolve));
  } finally {
    closeSync(fd);
  }

  let content = "";
  try {
    content = readFileSync(tmpFile, "utf-8").trim();
  } catch {
    return { success: false, error: "Session not found" };
  } finally {
    try {
      unlinkSync(tmpFile);
    } catch {
      // ignore cleanup error
    }
  }

  stderr = stderr.trim();

  if (exitCode !== 0) {
    return { success: false, error: stderr || `exit code ${exitCode}` };
  }

  if (!content) {
    return { success: false, error: "empty output" };
  }

  try {
    const data = JSON.parse(content) as OpenCodeExport;
    return { success: true, data };
  } catch {
    const truncated = !content.endsWith("}");
    return {
      success: false,
      error: truncated ? "truncated" : "parse error",
    };
  }
}

export async function opencodeUploadCommand(sessionId: string): Promise<void> {
  if (!sessionId) {
    console.error("Error: Session ID is required");
    process.exit(1);
  }

  console.log(`Uploading OpenCode session: ${sessionId}`);

  // Read session from OpenCode storage
  const result = await readSessionFromExport(sessionId);

  if (!result.success) {
    console.error(`Error: ${result.error}`);
    if (result.error?.includes("not found")) {
      console.error("Run 'opencode session list' to see available sessions");
    }
    process.exit(1);
  }

  const exportData = result.data as OpenCodeExport;

  // Skip subagent sessions (they have a parentID)
  if (exportData.info.parentID) {
    console.log("Skipping subagent session");
    process.exit(0);
  }

  const title = exportData.info.title || "Untitled";
  const messageCount = exportData.messages?.length ?? 0;
  console.log(`Session: "${title}" (${messageCount} messages)`);

  // Fetch pricing data
  const pricingFetcher = new LiteLLMPricingFetcher();
  const pricingData = await pricingFetcher.fetchModelPricing();
  const pricing = Object.fromEntries(pricingData);

  // Resolve git context from the session's working directory
  const cwd = exportData.info.directory ?? process.cwd();
  const gitContext = await resolveGitContext(cwd, undefined);

  if (gitContext?.repo) {
    console.log(`Repository: ${gitContext.repo}`);
  }

  // Convert to unified format
  console.log("Converting transcript...");
  const unifiedTranscript = convertOpenCodeTranscript(exportData, {
    pricing,
    gitContext,
    cwd,
  });

  if (!unifiedTranscript) {
    console.error("Error: Failed to convert transcript");
    process.exit(1);
  }

  // Upload using shared logic (handles allowlist, redaction, multi-env upload)
  console.log("Uploading...");
  const uploadResult = await uploadUnifiedToAllEnvs({
    unifiedTranscript,
    sessionId,
    cwd,
  });

  // Exit if skipped due to allowlist
  if (uploadResult.skipped) {
    console.log("Skipped: Repository not in allowlist");
    process.exit(0);
  }

  if (uploadResult.anySuccess && uploadResult.id) {
    console.log("");
    console.log("Upload successful!");
    console.log(`Transcript ID: ${uploadResult.id}`);

    // Show URL for each successful environment
    for (const envResult of uploadResult.results) {
      if (envResult.success) {
        const url = `${envResult.baseURL}/app/logs/${uploadResult.id}`;
        console.log(`View: ${url}`);
      }
    }
  } else {
    console.error("");
    console.error("Upload failed:");
    for (const envResult of uploadResult.results) {
      if (!envResult.success && envResult.error) {
        console.error(`  ${envResult.envName}: ${envResult.error}`);
      }
    }
    process.exit(1);
  }
}
