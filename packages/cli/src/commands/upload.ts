import { resolve } from "path";
import { sync as spawnSync } from "cross-spawn";
import { existsSync, readFileSync } from "fs";
import { discoverAllTranscripts, type DiscoveredTranscript, type TranscriptSource } from "@agentlogs/shared";
import { convertOpenCodeTranscript, type OpenCodeExport } from "@agentlogs/shared/opencode";
import { convertClineTranscript, type ClineMessage, type ClineTaskMetadata } from "@agentlogs/shared";
import { convertPiTranscript, type PiSessionEntry, type PiSessionHeader } from "@agentlogs/shared";
import { LiteLLMPricingFetcher } from "@agentlogs/shared/pricing";
import { resolveGitContext } from "@agentlogs/shared/claudecode";
import { pickTranscript } from "../tui/transcript-picker";
import { performUploadToAllEnvs, uploadUnifiedToAllEnvs } from "../lib/perform-upload";
import { getAuthenticatedEnvironments } from "../config";

export interface UploadCommandOptions {
  source?: TranscriptSource;
  latest?: boolean;
}

/**
 * Interactive upload command - discovers transcripts and shows a picker
 */
export async function interactiveUploadCommand(directory?: string, options: UploadCommandOptions = {}): Promise<void> {
  // Check authentication first
  const authenticatedEnvs = await getAuthenticatedEnvironments();
  if (authenticatedEnvs.length === 0) {
    console.error("You must be logged in to upload transcripts.");
    console.error("Run `agentlogs login agentlogs.ai` to authenticate.");
    process.exit(1);
  }

  // Resolve directory filter
  const cwdFilter = directory ? resolve(directory) : undefined;

  // Discover transcripts
  const transcripts = await discoverAllTranscripts({
    sources: options.source ? [options.source] : undefined,
    cwd: cwdFilter,
    limit: 100,
  });

  if (transcripts.length === 0) {
    const filterDesc = [
      cwdFilter ? `directory: ${cwdFilter}` : null,
      options.source ? `source: ${options.source}` : null,
    ]
      .filter(Boolean)
      .join(", ");

    console.log(filterDesc ? `No transcripts found matching filters (${filterDesc}).` : "No transcripts found.");
    return;
  }

  // If --latest, pick the most recent without showing picker
  let selected: DiscoveredTranscript | null = null;

  if (options.latest) {
    selected = transcripts[0]; // Already sorted by timestamp desc
    console.log(`Auto-selecting most recent transcript: ${selected.id}`);
  } else {
    // Show interactive picker
    selected = await pickTranscript(transcripts);
  }

  if (!selected) {
    process.exit(0);
  }

  // Upload the selected transcript
  const success = await uploadTranscript(selected);
  process.exit(success ? 0 : 1);
}

/**
 * Upload a single discovered transcript
 * Returns true on success, false on failure
 */
async function uploadTranscript(transcript: DiscoveredTranscript): Promise<boolean> {
  console.log("");
  console.log(`Uploading ${transcript.source} transcript: ${transcript.id}`);

  if (transcript.cwd) {
    console.log(`Directory: ${transcript.cwd}`);
  }

  try {
    switch (transcript.source) {
      case "claude-code":
        return await uploadClaudeCodeTranscript(transcript);
      case "codex":
        return await uploadCodexTranscript(transcript);
      case "opencode":
        return await uploadOpenCodeTranscript(transcript);
      case "cline":
        return await uploadClineTranscript(transcript);
      case "pi":
        return await uploadPiTranscript(transcript);
    }
  } catch (error) {
    console.error("");
    console.error("Upload failed:", error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function uploadClaudeCodeTranscript(transcript: DiscoveredTranscript): Promise<boolean> {
  const result = await performUploadToAllEnvs({
    transcriptPath: transcript.path,
    sessionId: transcript.id,
    cwdOverride: transcript.cwd ?? undefined,
    source: "claude-code",
  });

  return printUploadResult(result);
}

async function uploadCodexTranscript(transcript: DiscoveredTranscript): Promise<boolean> {
  const result = await performUploadToAllEnvs({
    transcriptPath: transcript.path,
    sessionId: transcript.id,
    cwdOverride: transcript.cwd ?? undefined,
    source: "codex",
  });

  return printUploadResult(result);
}

async function uploadOpenCodeTranscript(transcript: DiscoveredTranscript): Promise<boolean> {
  // Read the session from OpenCode storage
  const exportData = readOpenCodeSession(transcript.id);

  if (!exportData) {
    throw new Error(`Failed to read OpenCode session: ${transcript.id}`);
  }

  // Fetch pricing data
  const pricingFetcher = new LiteLLMPricingFetcher();
  const pricingData = await pricingFetcher.fetchModelPricing();
  const pricing = Object.fromEntries(pricingData);

  // Resolve git context
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
    throw new Error("Failed to convert OpenCode transcript");
  }

  // Upload
  console.log("Uploading...");
  const result = await uploadUnifiedToAllEnvs({
    unifiedTranscript,
    sessionId: transcript.id,
    cwd,
  });

  if (result.skipped) {
    console.log("");
    console.log("Skipped: Repository not in allowlist");
    return true; // Skipped is not a failure
  }

  if (result.anySuccess && result.id) {
    console.log("");
    console.log("Upload successful!");
    console.log(`Transcript ID: ${result.id}`);

    for (const envResult of result.results) {
      if (envResult.success) {
        const url = `${envResult.baseURL}/s/${result.id}`;
        console.log(`View: ${url}`);
      }
    }
    return true;
  } else {
    console.error("");
    console.error("Upload failed:");
    for (const envResult of result.results) {
      if (!envResult.success && envResult.error) {
        console.error(`  ${envResult.envName}: ${envResult.error}`);
      }
    }
    return false;
  }
}

async function uploadClineTranscript(transcript: DiscoveredTranscript): Promise<boolean> {
  // Read the conversation history
  if (!existsSync(transcript.path)) {
    throw new Error(`Failed to read Cline task: ${transcript.path}`);
  }

  const content = readFileSync(transcript.path, "utf-8");
  let messages: ClineMessage[];
  try {
    messages = JSON.parse(content) as ClineMessage[];
  } catch {
    throw new Error(`Failed to parse Cline task: ${transcript.path}`);
  }

  // Try to load metadata
  let metadata: ClineTaskMetadata | undefined;
  const metadataPath = resolve(transcript.path, "..", "task_metadata.json");
  if (existsSync(metadataPath)) {
    try {
      metadata = JSON.parse(readFileSync(metadataPath, "utf-8")) as ClineTaskMetadata;
    } catch {
      // Skip invalid metadata
    }
  }

  // Fetch pricing data
  const pricingFetcher = new LiteLLMPricingFetcher();
  const pricingData = await pricingFetcher.fetchModelPricing();
  const pricing = Object.fromEntries(pricingData);

  // Resolve git context
  const cwd = process.cwd();
  const gitContext = await resolveGitContext(cwd, undefined);

  if (gitContext?.repo) {
    console.log(`Repository: ${gitContext.repo}`);
  }

  // Convert to unified format
  console.log("Converting transcript...");
  const result = convertClineTranscript(messages, {
    pricing,
    gitContext,
    cwd,
    taskId: transcript.id,
    metadata,
    clientVersion: metadata?.environment_history?.[0]?.cline_version,
  });

  if (!result) {
    throw new Error("Failed to convert Cline transcript");
  }

  // Upload
  console.log("Uploading...");
  const uploadResult = await uploadUnifiedToAllEnvs({
    unifiedTranscript: result.transcript,
    sessionId: transcript.id,
    cwd,
  });

  if (uploadResult.skipped) {
    console.log("");
    console.log("Skipped: Repository not in allowlist");
    return true;
  }

  if (uploadResult.anySuccess && uploadResult.id) {
    console.log("");
    console.log("Upload successful!");
    console.log(`Transcript ID: ${uploadResult.id}`);

    for (const envResult of uploadResult.results) {
      if (envResult.success) {
        const url = `${envResult.baseURL}/s/${uploadResult.id}`;
        console.log(`View: ${url}`);
      }
    }
    return true;
  } else {
    console.error("");
    console.error("Upload failed:");
    for (const envResult of uploadResult.results) {
      if (!envResult.success && envResult.error) {
        console.error(`  ${envResult.envName}: ${envResult.error}`);
      }
    }
    return false;
  }
}

async function uploadPiTranscript(transcript: DiscoveredTranscript): Promise<boolean> {
  // Read the session file
  const sessionData = readPiSession(transcript.path);

  if (!sessionData) {
    throw new Error(`Failed to read Pi session: ${transcript.path}`);
  }

  // Fetch pricing data
  const pricingFetcher = new LiteLLMPricingFetcher();
  const pricingData = await pricingFetcher.fetchModelPricing();
  const pricing = Object.fromEntries(pricingData);

  // Resolve git context
  const cwd = sessionData.header.cwd ?? process.cwd();
  const gitContext = await resolveGitContext(cwd, undefined);

  if (gitContext?.repo) {
    console.log(`Repository: ${gitContext.repo}`);
  }

  // Convert to unified format
  console.log("Converting transcript...");
  const result = convertPiTranscript(sessionData, {
    pricing,
    gitContext,
    cwd,
  });

  if (!result) {
    throw new Error("Failed to convert Pi transcript");
  }

  // Upload
  console.log("Uploading...");
  const uploadResult = await uploadUnifiedToAllEnvs({
    unifiedTranscript: result.transcript,
    sessionId: transcript.id,
    cwd,
  });

  if (uploadResult.skipped) {
    console.log("");
    console.log("Skipped: Repository not in allowlist");
    return true;
  }

  if (uploadResult.anySuccess && uploadResult.id) {
    console.log("");
    console.log("Upload successful!");
    console.log(`Transcript ID: ${uploadResult.id}`);

    for (const envResult of uploadResult.results) {
      if (envResult.success) {
        const url = `${envResult.baseURL}/s/${uploadResult.id}`;
        console.log(`View: ${url}`);
      }
    }
    return true;
  } else {
    console.error("");
    console.error("Upload failed:");
    for (const envResult of uploadResult.results) {
      if (!envResult.success && envResult.error) {
        console.error(`  ${envResult.envName}: ${envResult.error}`);
      }
    }
    return false;
  }
}

/**
 * Read a Pi session from a JSONL file
 */
function readPiSession(filePath: string): { header: PiSessionHeader; entries: PiSessionEntry[] } | null {
  if (!existsSync(filePath)) {
    return null;
  }

  const content = readFileSync(filePath, "utf-8");
  const lines = content.split("\n").filter((l) => l.trim());

  if (lines.length === 0) {
    return null;
  }

  const header = JSON.parse(lines[0]) as PiSessionHeader;
  const entries: PiSessionEntry[] = [];

  for (let i = 1; i < lines.length; i++) {
    try {
      entries.push(JSON.parse(lines[i]) as PiSessionEntry);
    } catch {
      // Skip malformed lines
    }
  }

  return { header, entries };
}

/**
 * Read an OpenCode session using the opencode CLI export command.
 * This abstracts away the storage backend (JSON files or SQLite).
 */
function readOpenCodeSession(sessionId: string): OpenCodeExport | null {
  try {
    const result = spawnSync("opencode", ["export", sessionId], {
      encoding: "utf-8",
      timeout: 30000,
      stdio: ["pipe", "pipe", "pipe"],
    });

    if (result.status !== 0 || result.error) {
      return null;
    }

    const output = result.stdout.trim();
    if (!output) {
      return null;
    }

    return JSON.parse(output) as OpenCodeExport;
  } catch {
    return null;
  }
}

interface MultiEnvResult {
  results: Array<{
    envName: string;
    baseURL: string;
    success: boolean;
    error?: string;
  }>;
  id: string;
  sessionId: string;
  anySuccess: boolean;
  allSuccess: boolean;
}

/**
 * Print upload result and return success status
 */
function printUploadResult(result: MultiEnvResult): boolean {
  if (result.anySuccess && result.id) {
    console.log("");
    console.log("Upload successful!");
    console.log(`Transcript ID: ${result.id}`);

    for (const envResult of result.results) {
      if (envResult.success) {
        const url = `${envResult.baseURL}/s/${result.id}`;
        console.log(`View: ${url}`);
      }
    }
    return true;
  } else if (result.results.length === 0) {
    console.log("");
    console.log("Skipped: Repository not in allowlist");
    return true; // Skipped is not a failure
  } else {
    console.error("");
    console.error("Upload failed:");
    for (const envResult of result.results) {
      if (!envResult.success && envResult.error) {
        console.error(`  ${envResult.envName}: ${envResult.error}`);
      }
    }
    return false;
  }
}
