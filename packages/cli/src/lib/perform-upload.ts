import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import { dirname, isAbsolute, resolve } from "path";
import type { TranscriptSource, TranscriptVisibility, UploadBlob, UploadPayload } from "@agentlogs/shared";
import { convertClaudeCodeTranscript, resolveGitContext, type UnifiedTranscript } from "@agentlogs/shared/claudecode";
import { convertCodexTranscript } from "@agentlogs/shared/codex";
import { rewriteMarkdownLocalFileLinksDeep } from "@agentlogs/shared/file-links";
import { redactSecretsDeep } from "@agentlogs/shared/redact";
import { redactSensitiveFilesInTranscript } from "@agentlogs/shared/redact-sensitive-files";
import { LiteLLMPricingFetcher } from "@agentlogs/shared/pricing";
import { uploadTranscript } from "@agentlogs/shared/upload";
import type { UploadOptions } from "@agentlogs/shared/upload";
import { getAuthenticatedEnvironments, type EnvName } from "../config";
import { cacheTranscriptId, getOrCreateTranscriptId } from "../local-store";
import { getRepoVisibility } from "../settings";
import { type CwdCandidate, resolveUploadTarget } from "./repo-resolution";

export interface PerformUploadParams {
  transcriptPath: string;
  sessionId?: string;
  cwdOverride?: string;
  source?: TranscriptSource;
  /** Visibility override - if not set, server decides based on repo visibility */
  visibility?: TranscriptVisibility;
}

export interface PerformUploadResult {
  success: boolean;
  /** The database ID (CUID2) for stable links */
  id?: string;
  transcriptId?: string;
  eventCount: number;
  invalidLines: number;
  sessionId: string;
  cwd: string;
  unifiedTranscript: UnifiedTranscript;
  sha256: string;
  source: TranscriptSource;
  /** True if upload was skipped due to allowlist */
  skipped: boolean;
  /** Distinct repo ids seen across the session's directories (populated on skip). */
  candidatesSeen?: string[];
}

export function prepareUnifiedTranscriptForUpload(transcript: UnifiedTranscript): UnifiedTranscript {
  const linkRewrittenTranscript = rewriteMarkdownLocalFileLinksDeep(transcript, {
    repoId: transcript.git?.repo ?? null,
    branch: transcript.git?.branch ?? null,
  });
  const fileRedactedTranscript = redactSensitiveFilesInTranscript(linkRewrittenTranscript);
  return redactSecretsDeep(fileRedactedTranscript);
}

/**
 * Stamp the resolved repo id onto the transcript's embedded git context so the
 * server attributes the upload to the selected (allowlisted) repo. Without this,
 * a fork session keeps the origin-only repo derived during conversion, mis-
 * attributing the upload to the personal fork instead of the canonical repo that
 * passed the allowlist. Runs before link-rewriting/redaction so those use the
 * selected repo too. No-op when there is no git context or the repo already matches.
 */
export function stampResolvedRepoId(transcript: UnifiedTranscript, repoId: string | null): UnifiedTranscript {
  if (!repoId || !transcript.git || transcript.git.repo === repoId) {
    return transcript;
  }
  return { ...transcript, git: { ...transcript.git, repo: repoId } };
}

/**
 * Shared user-facing message lines for an allowlist-skipped upload, so every
 * command (claude-code, opencode, cline, pi) reports the same explanation.
 */
export function skipMessageLines(candidatesSeen: string[] | undefined): string[] {
  const seen = candidatesSeen ?? [];
  if (seen.length > 0) {
    return [
      "Upload skipped: none of the repos this session worked in are allowlisted.",
      `Repos seen: ${seen.join(", ")}`,
      "Run `agentlogs allow` in the target clone to enable uploads for it.",
    ];
  }
  return [
    "Upload skipped: no allowlisted git repository was found among this session's directories.",
    "Run `agentlogs allow` in the target clone to enable uploads for it.",
  ];
}

/**
 * Parameters for uploading a pre-converted UnifiedTranscript.
 * Use this when you've already converted from a source format.
 */
export interface UploadUnifiedParams {
  /** The converted transcript */
  unifiedTranscript: UnifiedTranscript;
  /** Session ID for deduplication and client ID generation */
  sessionId: string;
  /** Working directory for repo detection (allowlist check) */
  cwd: string;
  /** Binary blobs (images, etc.) to upload with the transcript */
  blobs?: UploadBlob[];
  /** Visibility override - if not set, uses repo settings or server default */
  visibility?: TranscriptVisibility;
}

export interface UploadUnifiedResult {
  results: EnvUploadResult[];
  /** The database ID (CUID2) for stable links */
  id: string;
  sessionId: string;
  anySuccess: boolean;
  allSuccess: boolean;
  /** True if upload was skipped due to allowlist */
  skipped: boolean;
  /** Distinct repo ids seen across the session's directories (populated on skip). */
  candidatesSeen?: string[];
}

/**
 * Build the weighted cwd candidate list for repo resolution. When an explicit
 * cwd override is supplied, only that directory is considered.
 */
function cwdCandidatesForParams(params: PerformUploadParams, parsed: ParsedTranscriptFile): CwdCandidate[] {
  const override = params.cwdOverride?.trim();
  if (override) {
    return [{ cwd: override, weight: 1 }];
  }
  const candidates = extractCwdCandidatesFromRecords(parsed.records);
  return candidates.length > 0 ? candidates : [{ cwd: parsed.cwd, weight: 1 }];
}

/**
 * Upload a single transcript to a specific environment.
 * Used by the sync command for per-environment uploads.
 *
 * Note: This function respects the allowlist. If the repo is not allowed,
 * it returns success=false with skipped=true.
 */
export async function performUpload(
  params: PerformUploadParams,
  options: UploadOptions = {},
): Promise<PerformUploadResult> {
  // Parse file first (cheap) to get cwd candidates for allowlist check
  const parsed = parseTranscriptFile(params);

  // Resolve the best allowlisted repo across all of the session's directories
  // (and all their remotes) before expensive conversion.
  const target = await resolveUploadTarget(cwdCandidatesForParams(params, parsed), parsed.cwd);
  if (!target.allowed) {
    return {
      success: false,
      eventCount: parsed.records.length,
      invalidLines: parsed.invalidLines,
      sessionId: "",
      cwd: parsed.cwd,
      unifiedTranscript: {} as UnifiedTranscript, // Empty placeholder, not used when skipped
      sha256: "",
      source: params.source ?? "claude-code",
      skipped: true,
      candidatesSeen: target.candidatesSeen,
    };
  }

  // Attribute conversion + git context to the resolved repo's working directory.
  parsed.cwd = target.cwd;
  const repoId = target.repoId;

  // Now do expensive conversion (pass pre-parsed data)
  const converted = await convertTranscriptFile(params, parsed);

  // Attribute the transcript to the resolved repo (not the origin-only repo from conversion).
  const preparedTranscript = prepareUnifiedTranscriptForUpload(
    stampResolvedRepoId(converted.unifiedTranscript, repoId),
  );

  // Compute sha256 from prepared unified transcript
  const unifiedJson = JSON.stringify(preparedTranscript);
  const sha256 = createHash("sha256").update(unifiedJson).digest("hex");

  // Generate stable client ID for this transcript
  const clientId = await getOrCreateTranscriptId(converted.sessionId);

  // Determine visibility: explicit override > repo setting > server default
  const visibility = params.visibility ?? getRepoVisibility(repoId);

  const payload: UploadPayload = {
    id: clientId,
    sha256,
    unifiedTranscript: preparedTranscript,
    blobs: converted.blobs.length > 0 ? converted.blobs : undefined,
    visibility,
  };

  const result = await uploadTranscript(payload, options);

  // Cache the server's returned ID (handles case where server returns existing ID)
  if (result.success && result.id) {
    await cacheTranscriptId(converted.sessionId, result.id);
  }

  return {
    ...result,
    eventCount: converted.eventCount,
    invalidLines: converted.invalidLines,
    sessionId: converted.sessionId,
    unifiedTranscript: preparedTranscript,
    sha256,
    source: params.source ?? "claude-code",
    cwd: converted.cwd,
    skipped: false,
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

/**
 * Collect every distinct cwd referenced by the transcript, weighted by how many
 * records mention it. Ordered by descending weight, ties broken by first
 * appearance. Used to attribute a session to the repo it actually worked in,
 * rather than the first (often a home/orchestration) directory.
 */
export function extractCwdCandidatesFromRecords(records: Record<string, unknown>[]): CwdCandidate[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const cwd = typeof record.cwd === "string" ? record.cwd.trim() : "";
    if (cwd) {
      counts.set(cwd, (counts.get(cwd) ?? 0) + 1);
    }
  }
  // Map preserves insertion (first-appearance) order; a stable sort by descending
  // weight therefore keeps first appearance as the tie-break.
  return [...counts.entries()].map(([cwd, weight]) => ({ cwd, weight })).sort((a, b) => b.weight - a.weight);
}

function extractGitBranchFromRecords(records: Record<string, unknown>[]): string | undefined {
  for (const record of records) {
    const gitBranch = typeof record.gitBranch === "string" ? record.gitBranch.trim() : "";
    if (gitBranch) {
      return gitBranch;
    }
  }
  return undefined;
}

export interface EnvUploadResult {
  envName: EnvName;
  baseURL: string;
  success: boolean;
  /** The database ID (CUID2) for stable links */
  id?: string;
  transcriptId?: string;
  error?: string;
}

export interface MultiEnvUploadResult {
  results: EnvUploadResult[];
  eventCount: number;
  /** The database ID (CUID2) for stable links */
  id: string;
  sessionId: string;
  anySuccess: boolean;
  allSuccess: boolean;
  /** Distinct repo ids seen across the session's directories (populated on skip). */
  candidatesSeen?: string[];
}

interface ParsedTranscriptFile {
  records: Record<string, unknown>[];
  cwd: string;
  invalidLines: number;
}

/**
 * Parse a JSONL transcript file and extract cwd.
 * This is cheap and can be used to check allowlist before expensive conversion.
 */
function parseTranscriptFile(params: PerformUploadParams): ParsedTranscriptFile {
  const { transcriptPath } = params;

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

  if (records.length === 0) {
    throw new Error("No transcript events found in the specified file.");
  }

  const cwd =
    params.cwdOverride && params.cwdOverride.trim().length > 0
      ? params.cwdOverride.trim()
      : (extractCwdFromRecords(records) ?? process.cwd());

  return { records, cwd, invalidLines };
}

/**
 * Convert a Claude Code or Codex JSONL transcript file to UnifiedTranscript.
 * This is the expensive step - call parseTranscriptFile first if you need to check allowlist.
 * Pass preParsed to avoid double-parsing.
 */
export async function convertTranscriptFile(
  params: PerformUploadParams,
  preParsed?: ParsedTranscriptFile,
): Promise<{
  unifiedTranscript: UnifiedTranscript;
  blobs: UploadBlob[];
  sessionId: string;
  cwd: string;
  eventCount: number;
  invalidLines: number;
}> {
  const { sessionId, source = "claude-code" } = params;
  const parsed = preParsed ?? parseTranscriptFile(params);

  const pricingFetcher = new LiteLLMPricingFetcher();
  const pricingData = await pricingFetcher.fetchModelPricing();
  const pricing = Object.fromEntries(pricingData);

  // Resolve git context from .git/config for accurate repo detection
  const gitBranch = extractGitBranchFromRecords(parsed.records);
  const gitContext = await resolveGitContext(parsed.cwd, gitBranch);

  const converterOptions = { pricing, gitContext };

  const conversionResult =
    source === "codex"
      ? convertCodexTranscript(parsed.records, { pricing })
      : convertClaudeCodeTranscript(parsed.records, converterOptions);

  if (!conversionResult) {
    throw new Error(`Unable to convert ${source} transcript to unified format.`);
  }

  const { transcript, blobs: transcriptBlobs } = conversionResult;

  const finalSessionId = sessionId ?? transcript.id;
  if (!finalSessionId) {
    throw new Error("Transcript did not include a session identifier.");
  }

  if (sessionId && sessionId !== transcript.id) {
    throw new Error(`Provided sessionId (${sessionId}) does not match unified transcript id (${transcript.id}).`);
  }

  // Convert Map<sha256, TranscriptBlob> to UploadBlob[]
  const uploadBlobs: UploadBlob[] = [];
  for (const [blobSha256, blob] of transcriptBlobs) {
    uploadBlobs.push({
      sha256: blobSha256,
      data: new Uint8Array(blob.data),
      mediaType: blob.mediaType,
    });
  }

  return {
    unifiedTranscript: transcript,
    blobs: uploadBlobs,
    sessionId: finalSessionId,
    cwd: parsed.cwd,
    eventCount: parsed.records.length,
    invalidLines: parsed.invalidLines,
  };
}

/**
 * Upload a Claude Code or Codex transcript to all authenticated environments.
 * Checks allowlist first, then converts and uploads.
 */
export async function performUploadToAllEnvs(params: PerformUploadParams): Promise<MultiEnvUploadResult> {
  // Parse file first (cheap) to get cwd candidates for allowlist check
  const parsed = parseTranscriptFile(params);

  // Resolve the best allowlisted repo across all of the session's directories
  // (and all their remotes) before expensive conversion.
  const target = await resolveUploadTarget(cwdCandidatesForParams(params, parsed), parsed.cwd);
  if (!target.allowed) {
    return {
      results: [],
      eventCount: parsed.records.length,
      id: "",
      sessionId: "",
      anySuccess: false,
      allSuccess: false,
      candidatesSeen: target.candidatesSeen,
    };
  }

  // Attribute conversion + git context to the resolved repo's working directory.
  parsed.cwd = target.cwd;

  // Now do expensive conversion (pass pre-parsed data to avoid double-parsing)
  const converted = await convertTranscriptFile(params, parsed);

  // Upload using shared logic (allowlist already checked, skip that check)
  const result = await uploadUnifiedToAllEnvs({
    unifiedTranscript: converted.unifiedTranscript,
    sessionId: converted.sessionId,
    cwd: converted.cwd,
    blobs: converted.blobs,
    visibility: params.visibility,
  });

  // Handle skipped case (shouldn't happen since we checked above, but be safe)
  if (result.skipped) {
    return {
      results: [],
      eventCount: converted.eventCount,
      id: "",
      sessionId: converted.sessionId,
      anySuccess: false,
      allSuccess: false,
      candidatesSeen: result.candidatesSeen,
    };
  }

  return {
    results: result.results,
    eventCount: converted.eventCount,
    id: result.id,
    sessionId: result.sessionId,
    anySuccess: result.anySuccess,
    allSuccess: result.allSuccess,
  };
}

/**
 * Upload a pre-converted UnifiedTranscript to all authenticated environments.
 * This is the shared upload logic used by all sources (Claude Code, OpenCode, Codex, etc.)
 *
 * Handles:
 * - Allowlist check (skips upload if repo not allowed)
 * - Secret redaction
 * - SHA256 computation
 * - Client ID generation
 * - Multi-environment upload
 */
export async function uploadUnifiedToAllEnvs(params: UploadUnifiedParams): Promise<UploadUnifiedResult> {
  const { unifiedTranscript, sessionId, cwd, blobs, visibility: visibilityOverride } = params;

  // Check if repo is allowed for capture. Considers every remote of the cwd
  // (not just origin), so fork-based workflows resolve to the canonical repo.
  const target = await resolveUploadTarget([{ cwd, weight: 1 }], cwd);
  if (!target.allowed) {
    return {
      results: [],
      id: "",
      sessionId,
      anySuccess: false,
      allSuccess: false,
      skipped: true,
      candidatesSeen: target.candidatesSeen,
    };
  }
  const repoId = target.repoId;

  const authenticatedEnvs = await getAuthenticatedEnvironments();
  if (authenticatedEnvs.length === 0) {
    throw new Error("No authenticated environments found. Run `agentlogs login agentlogs.ai` first.");
  }

  // Attribute the transcript to the resolved repo (handles fork origin -> upstream).
  const preparedTranscript = prepareUnifiedTranscriptForUpload(stampResolvedRepoId(unifiedTranscript, repoId));

  // Compute sha256 from prepared unified transcript
  const unifiedJson = JSON.stringify(preparedTranscript);
  const sha256 = createHash("sha256").update(unifiedJson).digest("hex");

  // Generate stable client ID for this transcript
  const clientId = await getOrCreateTranscriptId(sessionId);

  // Determine visibility: explicit override > repo setting > server default
  const visibility = visibilityOverride ?? getRepoVisibility(repoId);

  const payload: UploadPayload = {
    id: clientId,
    sha256,
    unifiedTranscript: preparedTranscript,
    blobs: blobs && blobs.length > 0 ? blobs : undefined,
    visibility,
  };

  const results: EnvUploadResult[] = [];
  let id = "";

  for (const env of authenticatedEnvs) {
    try {
      const result = await uploadTranscript(payload, {
        serverUrl: env.baseURL,
        authToken: env.token,
      });

      if (result.success && result.id) {
        await cacheTranscriptId(sessionId, result.id);
        if (!id) {
          id = result.id;
        }
      }

      results.push({
        envName: env.name,
        baseURL: env.baseURL,
        success: result.success,
        id: result.id,
        transcriptId: result.transcriptId,
      });
    } catch (error) {
      results.push({
        envName: env.name,
        baseURL: env.baseURL,
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    results,
    id,
    sessionId,
    anySuccess: results.some((r) => r.success),
    allSuccess: results.every((r) => r.success),
    skipped: false,
  };
}
