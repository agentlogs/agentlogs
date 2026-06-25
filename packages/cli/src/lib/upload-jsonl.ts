import type { TranscriptSource } from "@agentlogs/shared";
import { getAuthenticatedEnvironments } from "../config";
import { performUploadToAllEnvs, resolveTranscriptPath, skipMessageLines } from "../lib/perform-upload";

export async function uploadCommand(transcriptArg: string, source: TranscriptSource = "claude-code"): Promise<void> {
  if (!transcriptArg) {
    console.error("The upload command expects a <transcript> argument.");
    process.exit(1);
  }

  const transcriptPath = resolveTranscriptPath(transcriptArg);

  if (!transcriptPath) {
    console.error(`Transcript file not found for path: ${transcriptArg}`);
    process.exit(1);
  }

  const authenticatedEnvs = await getAuthenticatedEnvironments();
  if (authenticatedEnvs.length === 0) {
    console.error("You must be logged in to upload transcripts.");
    console.error("Run `agentlogs login agentlogs.ai` to authenticate");
    process.exit(1);
  }

  const sourceLabel = source === "codex" ? "Codex" : "Claude Code";
  const envNames = authenticatedEnvs.map((e) => e.name).join(", ");
  console.log(`Uploading ${sourceLabel} transcript from ${transcriptPath}`);
  console.log(`Target environments: ${envNames}`);

  try {
    const result = await performUploadToAllEnvs({
      transcriptPath,
      source,
    });

    // Handle skipped uploads (repo not allowed)
    if (result.results.length === 0) {
      console.log("");
      for (const line of skipMessageLines(result.candidatesSeen)) {
        console.log(`- ${line}`);
      }
      return;
    }

    console.log("");
    for (const envResult of result.results) {
      const envLabel = envResult.envName;
      if (envResult.success) {
        console.log(`✓ ${envLabel}: uploaded successfully`);
        if (envResult.id) {
          console.log(`  ID: ${envResult.id}`);
        }
        if (envResult.transcriptId) {
          console.log(`  Transcript ID: ${envResult.transcriptId}`);
        }
      } else {
        console.log(`✗ ${envLabel}: upload failed`);
        if (envResult.error) {
          console.log(`  Error: ${envResult.error}`);
        }
      }
    }

    console.log("");
    if (result.allSuccess) {
      console.log(`✓ Upload complete (${result.eventCount} events)`);
    } else if (result.anySuccess) {
      console.log(`⚠ Partial upload (${result.eventCount} events) - some environments failed`);
      process.exit(1);
    } else {
      console.error("✗ Upload failed for all environments");
      process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unexpected error occurred while uploading transcript.");
    process.exit(1);
  }
}
