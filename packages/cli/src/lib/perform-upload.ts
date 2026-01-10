import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import type { TranscriptSource, UploadBlob, UploadPayload } from "@vibeinsights/shared";
import { convertClaudeCodeTranscript, type UnifiedTranscript } from "@vibeinsights/shared/claudecode";
import { convertCodexTranscript } from "@vibeinsights/shared/codex";
import { LiteLLMPricingFetcher } from "@vibeinsights/shared/pricing";
import { uploadTranscript } from "@vibeinsights/shared/upload";
import type { UploadOptions } from "@vibeinsights/shared/upload";

export interface PerformUploadParams {
  transcriptPath: string;
  sessionId?: string;
  cwdOverride?: string;
  source?: TranscriptSource;
}

export interface PerformUploadResult {
  success: boolean;
  transcriptId?: string;
  eventCount: number;
  invalidLines: number;
  sessionId: string;
  cwd: string;
  unifiedTranscript: UnifiedTranscript;
  sha256: string;
  source: TranscriptSource;
}

export async function performUpload(
  params: PerformUploadParams,
  options: UploadOptions = {},
): Promise<PerformUploadResult> {
  const { transcriptPath, sessionId, source = "claude-code" } = params;

  if (!transcriptPath) {
    throw new Error("No transcript path provided.");
  }

  if (!existsSync(transcriptPath)) {
    throw new Error(`Transcript file not found at path: ${transcriptPath}`);
  }

  const rawContent = readFileSync(transcriptPath, "utf8");
  const lines = rawContent.split(/\r?\n/);
  const records: Record<string, unknown>[] = [];
  let invalidLines = 0;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    try {
      const parsed = JSON.parse(line) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        records.push(parsed as Record<string, unknown>);
      } else {
        invalidLines += 1;
      }
    } catch {
      invalidLines += 1;
    }
  }

  if (invalidLines > 0) {
    console.warn(`Skipped ${invalidLines} line(s) that were not valid JSON.`);
  }

  if (records.length === 0) {
    throw new Error("No transcript events found in the specified file.");
  }

  const pricingFetcher = new LiteLLMPricingFetcher();
  const pricingData = await pricingFetcher.fetchModelPricing();
  const pricing = Object.fromEntries(pricingData);

  const converterOptions = {
    pricing,
  };

  const resolvedCwd =
    params.cwdOverride && params.cwdOverride.trim().length > 0
      ? params.cwdOverride.trim()
      : (extractCwdFromRecords(records) ?? process.cwd());

  const conversionResult =
    source === "codex"
      ? convertCodexTranscript(records, converterOptions)
      : convertClaudeCodeTranscript(records, converterOptions);

  if (!conversionResult) {
    throw new Error(`Unable to convert ${source} transcript to unified format.`);
  }

  const { transcript: unifiedTranscript, blobs: transcriptBlobs } = conversionResult;

  const finalSessionId = sessionId ?? unifiedTranscript.id;
  if (!finalSessionId) {
    throw new Error("Transcript did not include a session identifier.");
  }

  if (sessionId && sessionId !== unifiedTranscript.id) {
    throw new Error(
      `Provided sessionId (${sessionId}) does not match unified transcript id (${unifiedTranscript.id}).`,
    );
  }

  const eventCount = records.length;
  const sha256 = createHash("sha256").update(rawContent).digest("hex");

  // Convert Map<sha256, TranscriptBlob> to UploadBlob[]
  const uploadBlobs: UploadBlob[] = [];
  for (const [blobSha256, blob] of transcriptBlobs) {
    uploadBlobs.push({
      sha256: blobSha256,
      data: new Uint8Array(blob.data),
      mediaType: blob.mediaType,
    });
  }

  const payload: UploadPayload = {
    sha256,
    rawTranscript: rawContent,
    unifiedTranscript,
    blobs: uploadBlobs.length > 0 ? uploadBlobs : undefined,
  };

  const result = await uploadTranscript(payload, options);

  return {
    ...result,
    eventCount,
    invalidLines,
    sessionId: finalSessionId,
    unifiedTranscript,
    sha256,
    source,
    cwd: resolvedCwd,
  };
}

export function resolveTranscriptPath(inputPath: string): string | null {
  if (!inputPath) {
    return null;
  }

  if (isAbsolute(inputPath)) {
    return existsSync(inputPath) ? inputPath : null;
  }

  const checked = new Set<string>();

  const tryResolve = (basePath: string | undefined): string | null => {
    if (!basePath) {
      return null;
    }

    const candidate = resolve(basePath, inputPath);

    if (checked.has(candidate)) {
      return null;
    }

    checked.add(candidate);

    return existsSync(candidate) ? candidate : null;
  };

  const directCandidate = tryResolve(process.cwd()) ?? tryResolve(process.env.INIT_CWD) ?? tryResolve(process.env.PWD);

  if (directCandidate) {
    return directCandidate;
  }

  let current = process.cwd();

  while (true) {
    const candidate = tryResolve(current);
    if (candidate) {
      return candidate;
    }

    const parent = dirname(current);

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return null;
}

function extractCwdFromRecords(records: Record<string, unknown>[]): string | null {
  for (const record of records) {
    const cwd = typeof record.cwd === "string" ? record.cwd.trim() : "";
    if (cwd) {
      return cwd;
    }
  }
  return null;
}
