import { createHash } from "crypto";
import { promises as fs } from "fs";
import { homedir } from "os";
import { basename, extname, join, relative, resolve } from "path";
import { fetchTranscriptMetadata } from "@agentlogs/shared";
import { convertClaudeCodeTranscript, resolveGitContext } from "@agentlogs/shared/claudecode";
import { LiteLLMPricingFetcher } from "@agentlogs/shared/pricing";
import { getAuthenticatedEnvironments, type Environment } from "../../config";
import {
  extractCwdCandidatesFromRecords,
  extractGitBranchFromRecords,
  performUpload,
  prepareUnifiedTranscriptForUpload,
  skipMessageLines,
  stampResolvedRepoId,
} from "../../lib/perform-upload";
import { resolveUploadTarget } from "../../lib/repo-resolution";

interface LocalTranscriptInfo {
  transcriptId: string;
  path: string;
  sha256: string;
  cwd: string | null;
  repoId: string | null;
  displayPath: string;
}

const DEFAULT_CLAUDE_HOME = join(homedir(), ".claude");

export interface SyncCommandOptions {
  repoFilter?: string;
  claudeDir?: string;
}

export async function syncCommand(options: SyncCommandOptions = {}): Promise<void> {
  const { repoFilter, claudeDir } = options;

  const authenticatedEnvs = await getAuthenticatedEnvironments();
  if (authenticatedEnvs.length === 0) {
    console.error("You must be logged in to sync transcripts.");
    console.error("Run `agentlogs login agentlogs.ai` to authenticate");
    process.exit(1);
  }

  const claudeHome = claudeDir ? resolve(claudeDir) : (process.env.CLAUDE_HOME ?? DEFAULT_CLAUDE_HOME);
  const projectsRoot = join(claudeHome, "projects");

  const localTranscripts = await discoverLocalTranscripts(projectsRoot);

  if (localTranscripts.length === 0) {
    console.log(`No local Claude Code transcripts were found under ${projectsRoot}. Nothing to sync.`);
    return;
  }

  const candidateLocalTranscripts = repoFilter
    ? localTranscripts.filter((item) => item.repoId === repoFilter)
    : localTranscripts;

  if (repoFilter && candidateLocalTranscripts.length === 0) {
    const unknownCount = localTranscripts.filter((item) => item.repoId === null).length;
    console.log(`No local Claude Code transcripts matched repo ${repoFilter}.`);
    if (unknownCount > 0) {
      console.log(`${unknownCount} transcript(s) were skipped because their repo could not be determined.`);
    }
    return;
  }

  const envNames = authenticatedEnvs.map((e) => e.name).join(", ");
  console.log(`Syncing to environments: ${envNames}`);
  console.log(`Found ${candidateLocalTranscripts.length} local transcript(s)\n`);

  // Sync to each environment
  for (const env of authenticatedEnvs) {
    await syncToEnvironment(env, candidateLocalTranscripts, repoFilter);
  }
}

async function syncToEnvironment(
  env: Environment & { token: string },
  localTranscripts: LocalTranscriptInfo[],
  repoFilter?: string,
): Promise<void> {
  const envLabel = env.name;
  console.log(`\n--- ${envLabel} (${env.baseURL}) ---`);

  try {
    const remoteTranscripts = await fetchTranscriptMetadata({
      serverUrl: env.baseURL,
      authToken: env.token,
    });

    const relevantRemoteTranscripts = repoFilter
      ? remoteTranscripts.filter((transcript) => transcript.repoId === repoFilter)
      : remoteTranscripts;

    const remoteShaById = new Map<string, string>();
    for (const transcript of relevantRemoteTranscripts) {
      remoteShaById.set(transcript.transcriptId, transcript.sha256);
    }

    const transcriptsToUpload = localTranscripts.filter((transcript) => {
      const remoteSha = remoteShaById.get(transcript.transcriptId);
      return !remoteSha || remoteSha !== transcript.sha256;
    });

    if (transcriptsToUpload.length === 0) {
      console.log("All local transcripts are up to date.");
      return;
    }

    console.log(`Uploading ${transcriptsToUpload.length} transcript(s)...`);

    let successCount = 0;
    let skippedCount = 0;
    let failureCount = 0;
    const failures: Array<{ transcriptId: string; displayPath: string; reason: string }> = [];

    for (const [index, transcript] of transcriptsToUpload.entries()) {
      const label = `${index + 1}/${transcriptsToUpload.length}`;
      const repoSuffix = transcript.repoId ? ` • ${transcript.repoId}` : "";
      const context = `${transcript.transcriptId} – ${transcript.displayPath}${repoSuffix}`;
      try {
        const result = await performUpload(
          {
            transcriptPath: transcript.path,
            sessionId: transcript.transcriptId,
            cwdOverride: transcript.cwd ?? undefined,
          },
          {
            serverUrl: env.baseURL,
            authToken: env.token,
          },
        );

        if (result.skipped) {
          skippedCount += 1;
          console.log(`[${label}] - ${context} • skipped (repo not allowed)`);
        } else if (result.success) {
          successCount += 1;
          console.log(
            `[${label}] ✓ ${context} • ${result.eventCount} events${result.transcriptId ? ` → ${result.transcriptId}` : ""}`,
          );
        } else {
          failureCount += 1;
          const reason = "Upload returned unsuccessful response.";
          console.error(`[${label}] ✗ ${context} • ${reason}`);
          failures.push({ transcriptId: transcript.transcriptId, displayPath: transcript.displayPath, reason });
        }
      } catch (error) {
        failureCount += 1;
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[${label}] ✗ ${context} • ${reason}`);
        failures.push({ transcriptId: transcript.transcriptId, displayPath: transcript.displayPath, reason });
      }
    }

    const skippedSuffix = skippedCount > 0 ? `, ${skippedCount} skipped` : "";
    console.log(`Sync complete: ${successCount} uploaded, ${failureCount} failed${skippedSuffix}.`);

    if (failures.length > 0) {
      console.error("Failed transcript details:");
      for (const failure of failures.slice(0, 10)) {
        console.error(`  - ${failure.transcriptId} (${failure.displayPath}): ${failure.reason}`);
      }
      if (failures.length > 10) {
        console.error(`  …and ${failures.length - 10} more failures.`);
      }
    }
  } catch (error) {
    console.error(`Error syncing to ${envLabel}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function discoverLocalTranscripts(projectsRoot: string): Promise<LocalTranscriptInfo[]> {
  if (!(await isDirectory(projectsRoot))) {
    return [];
  }

  const projectEntries = await fs.readdir(projectsRoot, { withFileTypes: true });
  const collected: LocalTranscriptInfo[] = [];

  // Fetch pricing data once for all transcripts
  const pricingFetcher = new LiteLLMPricingFetcher();
  const pricingData = await pricingFetcher.fetchModelPricing();
  const pricing = Object.fromEntries(pricingData);

  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory()) {
      continue;
    }

    const projectPath = join(projectsRoot, projectEntry.name);
    const transcriptFiles = await fs.readdir(projectPath, { withFileTypes: true });

    for (const file of transcriptFiles) {
      if (!file.isFile() || extname(file.name) !== ".jsonl") {
        continue;
      }

      const filePath = join(projectPath, file.name);
      const transcriptId = basename(file.name, ".jsonl");

      try {
        const raw = await fs.readFile(filePath, "utf8");
        // Use the same permission and attribution rules as the upload, so repo
        // filters and comparison hashes describe the payload sent to the server.
        const records = parseTranscriptRecords(raw);
        const candidates = extractCwdCandidatesFromRecords(records);
        const fallbackCwd = process.cwd();
        const target = await resolveUploadTarget(
          candidates.length ? candidates : [{ cwd: fallbackCwd, weight: 1 }],
          candidates[0]?.cwd ?? fallbackCwd,
        );
        if (!target.allowed) {
          process.stdout.write(
            `${filePath}: ${skipMessageLines(target.candidatesSeen, target.skipReason).join("\n")}\n`,
          );
          continue;
        }
        const { cwd, repoId } = target;
        const gitBranch = extractGitBranchFromRecords(records, cwd);
        const gitContext = cwd ? await resolveGitContext(cwd, gitBranch) : null;

        const conversionResult = convertClaudeCodeTranscript(records, {
          pricing,
          gitContext,
        });

        if (!conversionResult) {
          console.warn(`Skipped transcript at ${filePath}: Could not convert to unified format`);
          continue;
        }

        // Compute sha256 from the prepared upload transcript so local/remote comparisons stay aligned
        const preparedTranscript = prepareUnifiedTranscriptForUpload(
          stampResolvedRepoId(conversionResult.transcript, repoId),
        );
        const unifiedJson = JSON.stringify(preparedTranscript);
        const sha256 = createHash("sha256").update(unifiedJson).digest("hex");

        collected.push({
          transcriptId,
          path: filePath,
          sha256,
          cwd,
          repoId,
          displayPath: relative(projectsRoot, filePath) || file.name,
        });
      } catch (error) {
        console.warn(`Skipped transcript at ${filePath}: ${(error as Error).message}`);
      }
    }
  }

  return collected;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const stat = await fs.stat(path);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

function parseTranscriptRecords(rawTranscript: string): Record<string, unknown>[] {
  const lines = rawTranscript.split(/\r?\n/);
  const records: Record<string, unknown>[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        records.push(parsed as Record<string, unknown>);
      }
    } catch {
      continue;
    }
  }

  return records;
}
