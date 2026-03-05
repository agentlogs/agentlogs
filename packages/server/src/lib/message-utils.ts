import type { UnifiedTranscriptMessage } from "@agentlogs/shared/claudecode";

/**
 * Type guard to safely check if value is a plain object
 */
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Generate a human-readable summary for a tool call
 */
export function getToolSummary(message: UnifiedTranscriptMessage): string {
  if (message.type !== "tool-call") return "";

  // Handle errors first
  if (message.error || message.isError) {
    return "Failed";
  }

  const { output, toolName } = message;

  // Handle missing toolName
  if (!toolName) {
    return "Completed";
  }

  // Handle MCP tools (e.g., "mcp__chrome-devtools__click" → "Clicked")
  if (toolName.startsWith("mcp__")) {
    const parts = toolName.split("__");
    if (parts.length >= 3) {
      const action = parts[parts.length - 1];
      return action.charAt(0).toUpperCase() + action.slice(1);
    }
    return "Completed";
  }

  // Tool-specific summaries
  switch (toolName) {
    case "Read": {
      if (typeof output === "string") {
        return `${output.split("\n").length} lines`;
      }
      if (isObject(output) && isObject(output.file)) {
        const file = output.file;
        const numLines = typeof file.numLines === "number" ? file.numLines : file.totalLines;
        if (typeof numLines === "number") return `${numLines} lines`;
      }
      return "Read file";
    }

    case "Grep": {
      if (isObject(output)) {
        if (typeof output.numMatches === "number") return `${output.numMatches} matches`;
        if (Array.isArray(output.filenames)) return `${output.filenames.length} files`;
      }
      return "Searched";
    }

    case "Glob": {
      if (isObject(output) && Array.isArray(output.filenames)) {
        return `${output.filenames.length} files`;
      }
      return "Found files";
    }

    case "Edit": {
      if (isObject(output) && typeof output.userModified === "boolean") {
        return output.userModified ? "Modified by user" : "Modified";
      }
      return "Modified";
    }

    case "Write":
      return "Created";

    case "Bash": {
      if (message.error) return "Failed";
      if (isObject(output)) {
        if (output.interrupted === true) return "Interrupted";
        if (output.stderr) return "Completed with errors";
      }
      return "Completed";
    }

    case "BashOutput": {
      if (isObject(output) && typeof output.status === "string") {
        return output.status;
      }
      return "Output retrieved";
    }

    case "Task": {
      if (isObject(output)) {
        const status = typeof output.status === "string" ? output.status : null;
        const toolCount = typeof output.totalToolUseCount === "number" ? output.totalToolUseCount : null;
        if (status && toolCount !== null) return `${status} (${toolCount} tools)`;
        if (status) return status;
      }
      return "Task completed";
    }

    case "TodoWrite": {
      if (isObject(output) && Array.isArray(output.newTodos)) {
        return `${output.newTodos.length} todos`;
      }
      return "Todos updated";
    }

    case "WebSearch": {
      if (isObject(output) && Array.isArray(output.results)) {
        return `${output.results.length} results`;
      }
      return "Searched web";
    }

    case "WebFetch":
      return "Fetched";

    case "KillShell":
      return "Killed shell";

    case "AskUserQuestion": {
      if (isObject(output) && isObject(output.answers)) {
        const count = Object.keys(output.answers).length;
        return `${count} ${count === 1 ? "answer" : "answers"}`;
      }
      return "Asked question";
    }

    default:
      return "Completed";
  }
}

/**
 * Get concise text summary of any message (for navigation, previews)
 * Max 60 characters, newlines removed
 */
export function getSummaryText(message: UnifiedTranscriptMessage): string {
  if (message.type === "user" || message.type === "agent") {
    return message.text.slice(0, 60).replace(/\n/g, " ");
  }

  if (message.type === "tool-call") {
    const summary = getToolSummary(message);
    return `${message.toolName}: ${summary}`;
  }

  if (message.type === "thinking") {
    return message.text.slice(0, 60).replace(/\n/g, " ");
  }

  return "Unknown message";
}

/**
 * Represents an image reference with sha256 hash
 */
export interface ImageReference {
  sha256: string;
  mediaType: string;
}

/**
 * Check if a value is an image reference with sha256
 */
function isImageReference(
  value: unknown,
): value is { type: "image"; source: { type: "sha256"; sha256: string; mediaType: string } } {
  if (!isObject(value)) return false;
  if (value.type !== "image") return false;
  if (!isObject(value.source)) return false;
  const source = value.source;
  return source.type === "sha256" && typeof source.sha256 === "string" && typeof source.mediaType === "string";
}

/**
 * Recursively extract all image references from a value
 */
export function extractImageReferences(value: unknown): ImageReference[] {
  const images: ImageReference[] = [];

  function traverse(v: unknown): void {
    if (v === null || v === undefined) return;

    if (isImageReference(v)) {
      images.push({
        sha256: v.source.sha256,
        mediaType: v.source.mediaType,
      });
      return;
    }

    if (Array.isArray(v)) {
      for (const item of v) {
        traverse(item);
      }
      return;
    }

    if (isObject(v)) {
      for (const key of Object.keys(v)) {
        traverse(v[key]);
      }
    }
  }

  traverse(value);
  return images;
}

/**
 * Replace image references in JSON with placeholder text for display
 * Returns a new object with image references replaced
 */
export function replaceImageReferencesForDisplay(value: unknown): unknown {
  if (value === null || value === undefined) return value;

  if (isImageReference(value)) {
    return `[Image: ${value.source.sha256.slice(0, 8)}...]`;
  }

  if (Array.isArray(value)) {
    return value.map((item) => replaceImageReferencesForDisplay(item));
  }

  if (isObject(value)) {
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      result[key] = replaceImageReferencesForDisplay(value[key]);
    }
    return result;
  }

  return value;
}
