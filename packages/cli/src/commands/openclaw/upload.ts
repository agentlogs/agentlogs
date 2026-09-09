import { existsSync } from "fs";
import { basename } from "path";
import { discoverOpenClawSessions } from "@agentlogs/shared";
import { resolveGitContext } from "@agentlogs/shared/claudecode";
import { convertOpenClawTranscript } from "@agentlogs/shared/openclaw";
import { loadOpenClawSession } from "@agentlogs/shared/openclaw-storage";
import { createLogger } from "@agentlogs/shared/logger";
import { skipMessageLines, uploadUnifiedToAllEnvs } from "../../lib/perform-upload";

const logger = createLogger("openclaw");

export async function uploadOpenClawSession(path: string, selectedId?: string): Promise<boolean> {
  const onWarning = (message: string) => logger.warn(message);
  const session = await loadOpenClawSession(path, selectedId, onWarning);
  // The session's own directory is authoritative. Missing metadata must not
  // silently attribute somebody else's exported chat to the caller's repository.
  if (!session.cwd)
    throw new Error("OpenClaw session has no working directory; cannot check repository capture permissions.");
  const cwd = session.cwd;
  const gitContext = await resolveGitContext(cwd, undefined);
  const unifiedTranscript = convertOpenClawTranscript(session.records, {
    gitContext,
    cwd,
    sessionId: session.sessionId,
    onWarning,
  });
  if (!unifiedTranscript) throw new Error("OpenClaw session contains no usable messages.");
  logger.info(`Uploading OpenClaw session: ${session.sessionId}`);
  const result = await uploadUnifiedToAllEnvs({ unifiedTranscript, sessionId: session.sessionId, cwd });
  if (result.skipped) {
    for (const line of skipMessageLines(result.candidatesSeen, result.skipReason)) logger.info(line);
    return true;
  }
  if (result.anySuccess && result.id) {
    logger.info("Upload successful!");
    logger.info(`Transcript ID: ${result.id}`);
    for (const env of result.results) if (env.success) logger.info(`View: ${env.baseURL}/s/${result.id}`);
  }
  for (const env of result.results) if (!env.success) logger.error(`${env.envName}: ${env.error ?? "Upload failed"}`);
  return result.allSuccess;
}

export async function openclawUploadCommand(sessionArg: string): Promise<void> {
  try {
    if (!sessionArg) throw new Error("An OpenClaw session ID or JSONL path is required.");
    if (existsSync(sessionArg)) {
      if (!(await uploadOpenClawSession(sessionArg))) process.exitCode = 1;
      return;
    }
    const sessions = await discoverOpenClawSessions({ limit: 1000 });
    const matches = sessions.filter((s) => s.id === sessionArg || basename(s.path) === sessionArg);
    if (matches.length !== 1)
      throw new Error(
        matches.length
          ? "Ambiguous OpenClaw session; pass its JSONL path."
          : "OpenClaw session not found. Use the picker or pass an exact session ID or JSONL path.",
      );
    if (!(await uploadOpenClawSession(matches[0].path, matches[0].id))) process.exitCode = 1;
  } catch (error) {
    logger.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
