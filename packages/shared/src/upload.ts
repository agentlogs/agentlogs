import { execSync } from "child_process";
import { resolve } from "path";
import { formatCwdWithTilde } from "./paths";
import type { UploadPayload, UploadResponse } from "./types";

const DEFAULT_SERVER_URL = "http://localhost:3000";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface UploadOptions {
  serverUrl?: string;
  authToken?: string;
  timeoutMs?: number;
}

/**
 * Check if a blob exists on the server using HEAD request.
 * Returns true if blob exists, false otherwise.
 */
async function checkBlobExists(
  sha256: string,
  serverUrl: string,
  authToken: string | null,
): Promise<boolean> {
  try {
    const response = await fetch(`${serverUrl}/api/blobs/${sha256}`, {
      method: "HEAD",
      headers: {
        ...(authToken && { Authorization: `Bearer ${authToken}` }),
      },
      signal: AbortSignal.timeout(5000),
    });
    return response.ok;
  } catch {
    // On error, assume blob doesn't exist (will be uploaded)
    return false;
  }
}

/**
 * Filter out blobs that already exist on the server.
 * Uses HEAD requests in parallel for efficiency.
 */
async function filterNewBlobs(
  blobs: UploadPayload["blobs"],
  serverUrl: string,
  authToken: string | null,
): Promise<UploadPayload["blobs"]> {
  if (!blobs || blobs.length === 0) {
    return undefined;
  }

  const results = await Promise.all(
    blobs.map(async (blob) => ({
      blob,
      exists: await checkBlobExists(blob.sha256, serverUrl, authToken),
    })),
  );

  const newBlobs = results.filter((r) => !r.exists).map((r) => r.blob);
  return newBlobs.length > 0 ? newBlobs : undefined;
}

/**
 * Upload transcript to Vibe Insights server.
 * Returns success status and optional transcript ID.
 */
export async function uploadTranscript(
  payload: UploadPayload,
  options: UploadOptions = {},
): Promise<{ success: boolean; transcriptId?: string }> {
  const serverUrl = options.serverUrl ?? process.env.VI_SERVER_URL ?? DEFAULT_SERVER_URL;
  const authToken = options.authToken ?? null;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const blobsToUpload = await filterNewBlobs(payload.blobs, serverUrl, authToken);

  const formData = new FormData();
  const filename = `${payload.unifiedTranscript.id || "transcript"}.jsonl`;

  formData.set("sha256", payload.sha256);
  formData.set("unifiedTranscript", JSON.stringify(payload.unifiedTranscript));
  formData.set(
    "transcript",
    new Blob([payload.rawTranscript], {
      type: "application/jsonl",
    }),
    filename,
  );

  // Add only new blobs as separate form fields with "blob:" prefix
  if (blobsToUpload) {
    for (const blob of blobsToUpload) {
      // Convert Uint8Array to ArrayBuffer for Blob compatibility
      const arrayBuffer = blob.data.buffer.slice(
        blob.data.byteOffset,
        blob.data.byteOffset + blob.data.byteLength,
      ) as ArrayBuffer;
      formData.append(`blob:${blob.sha256}`, new Blob([arrayBuffer], { type: blob.mediaType }), `${blob.sha256}.blob`);
    }
  }

  try {
    const response = await fetch(`${serverUrl}/api/ingest`, {
      method: "POST",
      headers: {
        ...(authToken && {
          Authorization: `Bearer ${authToken}`,
        }),
      },
      body: formData,
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      console.error(`Upload failed: ${response.status} ${response.statusText}`);
      return { success: false };
    }

    const result = (await response.json()) as unknown;

    if (isUploadResponse(result)) {
      return {
        success: true,
        transcriptId: result.transcriptId,
      };
    }

    console.error("Upload succeeded but response had unexpected shape:", result);
    return { success: false };
  } catch (error) {
    if (error instanceof Error) {
      console.error("Upload error:", error.message);
    }
    return { success: false };
  }
}

function isUploadResponse(data: unknown): data is UploadResponse {
  if (typeof data !== "object" || data === null) {
    return false;
  }

  const maybeResponse = data as Partial<UploadResponse>;

  return (
    typeof maybeResponse.success === "boolean" &&
    (maybeResponse.success === false || typeof maybeResponse.transcriptId === "string") &&
    (maybeResponse.eventsReceived === undefined || typeof maybeResponse.eventsReceived === "number")
  );
}

/**
 * Get repository metadata from git.
 * Returns null repoId if not a git repo.
 */
export function getRepoMetadata(cwd: string): {
  repoId: string | null;
  repoName: string;
  cwd: string;
} {
  const resolvedCwd = resolve(cwd);
  const formattedCwd = formatCwdWithTilde(resolvedCwd);

  try {
    const remoteUrl = execSync("git remote get-url origin", {
      cwd: resolvedCwd,
      encoding: "utf8",
      timeout: 2_000,
      stdio: ["pipe", "pipe", "ignore"],
    }).trim();

    const sanitizedRepoId = sanitizeRemote(remoteUrl);
    const repoName = sanitizedRepoId.split("/").pop() || "unknown";

    return {
      repoId: sanitizedRepoId,
      repoName,
      cwd: formattedCwd,
    };
  } catch {
    const repoName = resolvedCwd.split("/").pop() || "unknown";
    return {
      repoId: null,
      repoName,
      cwd: formattedCwd,
    };
  }
}

function sanitizeRemote(remoteUrl: string): string {
  const sshPattern = /^(?<user>[^@]+)@(?<host>[^:]+):(?<path>.+)$/;
  const sshMatch = remoteUrl.match(sshPattern);
  if (sshMatch?.groups) {
    return `${sshMatch.groups.host}/${sshMatch.groups.path.replace(/\.git$/i, "")}`;
  }

  try {
    const url = new URL(remoteUrl);
    const cleanPath = url.pathname.replace(/\.git$/i, "").replace(/^\//, "");
    return `${url.host}/${cleanPath}`;
  } catch {
    return remoteUrl.replace(/\.git$/i, "");
  }
}
