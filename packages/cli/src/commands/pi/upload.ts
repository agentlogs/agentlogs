/**
 * Pi Upload Command
 *
 * Manually upload a Pi session file to AgentLogs.
 */

import { existsSync, readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import { convertPiTranscript, type PiSessionEntry, type PiSessionHeader, type UploadBlob } from "@agentlogs/shared";
import { LiteLLMPricingFetcher } from "@agentlogs/shared/pricing";
import { resolveGitContext } from "@agentlogs/shared/claudecode";
import { skipMessageLines, uploadUnifiedToAllEnvs } from "../../lib/perform-upload";

const PI_SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

/**
 * Read a Pi session from a JSONL file.
 */
function readSessionFile(filePath: string): { header: PiSessionHeader; entries: PiSessionEntry[] } | null {
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
 * Find a session file by session ID.
 */
function findSessionById(sessionId: string): string | null {
  if (!existsSync(PI_SESSIONS_DIR)) {
    return null;
  }

  // Search through all project directories
  for (const projectDir of readdirSync(PI_SESSIONS_DIR)) {
    const projectPath = join(PI_SESSIONS_DIR, projectDir);
    if (!existsSync(projectPath)) continue;

    for (const sessionFile of readdirSync(projectPath)) {
      if (!sessionFile.endsWith(".jsonl")) continue;

      // Check if this file contains the session ID
      if (sessionFile.includes(sessionId)) {
        return join(projectPath, sessionFile);
      }

      // Also check the header
      const filePath = join(projectPath, sessionFile);
      try {
        const firstLine = readFileSync(filePath, "utf-8").split("\n")[0];
        const header = JSON.parse(firstLine) as PiSessionHeader;
        if (header.id === sessionId) {
          return filePath;
        }
      } catch {
        // Skip files we can't parse
      }
    }
  }

  return null;
}

/**
 * List recent Pi sessions.
 */
function listRecentSessions(limit: number = 10): Array<{ path: string; id: string; timestamp: string; cwd: string }> {
  const sessions: Array<{ path: string; id: string; timestamp: string; cwd: string }> = [];

  if (!existsSync(PI_SESSIONS_DIR)) {
    return sessions;
  }

  for (const projectDir of readdirSync(PI_SESSIONS_DIR)) {
    const projectPath = join(PI_SESSIONS_DIR, projectDir);
    if (!existsSync(projectPath)) continue;

    for (const sessionFile of readdirSync(projectPath)) {
      if (!sessionFile.endsWith(".jsonl")) continue;

      const filePath = join(projectPath, sessionFile);
      try {
        const firstLine = readFileSync(filePath, "utf-8").split("\n")[0];
        const header = JSON.parse(firstLine) as PiSessionHeader;
        sessions.push({
          path: filePath,
          id: header.id,
          timestamp: header.timestamp,
          cwd: header.cwd,
        });
      } catch {
        // Skip files we can't parse
      }
    }
  }

  // Sort by timestamp descending
  sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  return sessions.slice(0, limit);
}

export async function piUploadCommand(sessionIdOrPath?: string): Promise<void> {
  // If no argument, list recent sessions
  if (!sessionIdOrPath) {
    console.log("Recent Pi sessions:");
    console.log("");

    const sessions = listRecentSessions(10);
    if (sessions.length === 0) {
      console.log("No sessions found in", PI_SESSIONS_DIR);
      process.exit(1);
    }

    for (const session of sessions) {
      const date = new Date(session.timestamp);
      const dateStr = date.toLocaleString();
      console.log(`  ${session.id.substring(0, 8)}...  ${dateStr}`);
      console.log(`    ${session.cwd}`);
      console.log("");
    }

    console.log("Usage: agentlogs pi upload <session-id-or-path>");
    process.exit(0);
  }

  // Determine if argument is a path or session ID
  let sessionFile: string;
  // Expand ~ to home directory
  const expandedPath = sessionIdOrPath.startsWith("~") ? sessionIdOrPath.replace(/^~/, homedir()) : sessionIdOrPath;
  if (existsSync(expandedPath)) {
    sessionFile = expandedPath;
  } else {
    const found = findSessionById(sessionIdOrPath);
    if (!found) {
      console.error(`Error: Session not found: ${sessionIdOrPath}`);
      console.error(`Searched in: ${PI_SESSIONS_DIR}`);
      process.exit(1);
    }
    sessionFile = found;
  }

  console.log(`Uploading Pi session: ${basename(sessionFile)}`);

  // Read session
  const sessionData = readSessionFile(sessionFile);
  if (!sessionData) {
    console.error(`Error: Failed to read session file: ${sessionFile}`);
    process.exit(1);
  }

  const messageCount = sessionData.entries.filter((e) => e.type === "message").length;
  console.log(`Session: ${sessionData.header.id.substring(0, 8)}... (${messageCount} messages)`);

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
    console.error("Error: Failed to convert transcript");
    process.exit(1);
  }

  // Convert blobs Map to UploadBlob array
  const uploadBlobs: UploadBlob[] = [];
  for (const [sha256, blob] of result.blobs) {
    uploadBlobs.push({
      sha256,
      data: new Uint8Array(blob.data),
      mediaType: blob.mediaType,
    });
  }

  // Upload
  console.log("Uploading...");
  const uploadResult = await uploadUnifiedToAllEnvs({
    unifiedTranscript: result.transcript,
    sessionId: sessionData.header.id,
    cwd,
    blobs: uploadBlobs.length > 0 ? uploadBlobs : undefined,
  });

  // Handle results
  if (uploadResult.skipped) {
    for (const line of skipMessageLines(uploadResult.candidatesSeen)) {
      console.log(line);
    }
    process.exit(0);
  }

  if (uploadResult.anySuccess && uploadResult.id) {
    console.log("");
    console.log("Upload successful!");
    console.log(`Transcript ID: ${uploadResult.id}`);

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
