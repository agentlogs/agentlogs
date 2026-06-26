import { existsSync, readFileSync } from "fs";
import { discoverOpenClawSessions } from "@agentlogs/shared";
import { resolveGitContext } from "@agentlogs/shared/claudecode";
import { convertOpenClawTranscript, parseOpenClawRecords } from "@agentlogs/shared/openclaw";
import { uploadUnifiedToAllEnvs } from "../../lib/perform-upload";

/**
 * Resolve a CLI argument to an OpenClaw session JSONL path. Accepts a direct
 * file path, or a session id / filename fragment matched against discovery.
 */
async function resolveSessionPath(sessionArg: string): Promise<string | null> {
  if (existsSync(sessionArg)) {
    return sessionArg;
  }
  const sessions = await discoverOpenClawSessions({ limit: 1000 });
  const match = sessions.find((s) => s.id === sessionArg || s.path.includes(sessionArg));
  return match?.path ?? null;
}

export async function openclawUploadCommand(sessionArg: string): Promise<void> {
  if (!sessionArg) {
    console.error("Error: an OpenClaw session id or path is required");
    process.exit(1);
  }

  const filePath = await resolveSessionPath(sessionArg);
  if (!filePath) {
    console.error(`Error: OpenClaw session not found: ${sessionArg}`);
    console.error("Pass a path to a session .jsonl, or a session id from ~/.openclaw/session-backups/");
    process.exit(1);
  }

  let unifiedTranscript;
  let sessionId = sessionArg;
  let cwd = process.cwd();
  try {
    const records = parseOpenClawRecords(readFileSync(filePath, "utf-8"));
    const session = records.find((r) => r.type === "session") as { id?: string; cwd?: string } | undefined;
    sessionId = session?.id ?? sessionArg;
    cwd = session?.cwd ?? process.cwd();
    console.log(`Uploading OpenClaw session: ${sessionId}`);

    const gitContext = await resolveGitContext(cwd, undefined);
    if (gitContext?.repo) {
      console.log(`Repository: ${gitContext.repo}`);
    }

    console.log("Converting transcript...");
    unifiedTranscript = convertOpenClawTranscript(records, { gitContext, cwd });
  } catch (error) {
    console.error(`Error: failed to read/convert session: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }

  if (!unifiedTranscript) {
    console.error("Error: failed to convert transcript (no usable records)");
    process.exit(1);
  }

  console.log("Uploading...");
  const uploadResult = await uploadUnifiedToAllEnvs({ unifiedTranscript, sessionId, cwd });

  if (uploadResult.skipped) {
    console.log("Skipped: Repository not in allowlist");
    process.exit(0);
  }

  if (uploadResult.anySuccess && uploadResult.id) {
    console.log("");
    console.log("Upload successful!");
    console.log(`Transcript ID: ${uploadResult.id}`);
    for (const envResult of uploadResult.results) {
      if (envResult.success) {
        console.log(`View: ${envResult.baseURL}/s/${uploadResult.id}`);
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
