import { File, PatchDiff } from "@pierre/diffs/react";
import { FilePlus, Pencil, SquareTerminal } from "lucide-react";
import { Component, type ReactNode } from "react";

// Error boundary to catch PatchDiff rendering errors
class DiffErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode; fallback: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

interface DiffViewerProps {
  filePath: string;
  diff: string;
  lineOffset?: number;
  className?: string;
  hideHeader?: boolean;
}

/**
 * Compute diff statistics from a diff string
 */
function computeDiffStats(diff: string): { added: number; removed: number; modified: number } {
  const lines = diff.split("\n");
  let added = 0;
  let removed = 0;

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed++;
    }
  }

  // If there are both additions and removals, some are likely modifications
  const modified = Math.min(added, removed);

  return { added, removed, modified };
}

/**
 * Determine if this is a new file creation (all additions, no removals)
 */
function isNewFile(diff: string): boolean {
  const lines = diff.split("\n");
  for (const line of lines) {
    if (line.startsWith("-") && !line.startsWith("---")) {
      return false;
    }
  }
  return true;
}

/**
 * Convert a simple diff string (lines starting with +/-/space) to a proper unified diff patch format
 */
function convertToPatchFormat(filePath: string, diff: string, lineOffset: number = 1): string {
  const lines = diff.split("\n");

  // Filter to valid diff lines: +, -, or space (context)
  // Also include lines that don't start with these but aren't empty (treat as context)
  const diffLines: string[] = [];
  let additions = 0;
  let deletions = 0;
  let context = 0;

  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      diffLines.push(line);
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      diffLines.push(line);
      deletions++;
    } else if (line.startsWith(" ")) {
      // Context line
      diffLines.push(line);
      context++;
    } else if (line.length > 0 && !line.startsWith("@@") && !line.startsWith("---") && !line.startsWith("+++")) {
      // Treat non-prefixed non-empty lines as context (add space prefix)
      diffLines.push(` ${line}`);
      context++;
    }
  }

  if (diffLines.length === 0) {
    return "";
  }

  // Calculate line counts for hunk header
  // oldCount = deletions + context lines (lines in original file)
  // newCount = additions + context lines (lines in new file)
  const oldCount = deletions + context;
  const newCount = additions + context;

  const patchLines: string[] = [];

  // File headers and hunk header
  const isNew = deletions === 0 && additions > 0;
  const isDelete = additions === 0 && deletions > 0;

  if (isNew) {
    patchLines.push("--- /dev/null");
    patchLines.push(`+++ b/${filePath}`);
    patchLines.push(`@@ -0,0 +${lineOffset},${newCount} @@`);
  } else if (isDelete) {
    patchLines.push(`--- a/${filePath}`);
    patchLines.push("+++ /dev/null");
    patchLines.push(`@@ -${lineOffset},${oldCount} +0,0 @@`);
  } else {
    patchLines.push(`--- a/${filePath}`);
    patchLines.push(`+++ b/${filePath}`);
    patchLines.push(`@@ -${lineOffset},${oldCount} +${lineOffset},${newCount} @@`);
  }

  // Add diff lines
  for (const line of diffLines) {
    patchLines.push(line);
  }

  // Ensure trailing newline for proper patch format
  return patchLines.join("\n") + "\n";
}

/**
 * Get the file name from a file path
 */
function getFileName(filePath: string): string {
  return filePath.split("/").pop() || filePath;
}

export function DiffViewer({ filePath, diff, lineOffset = 1, className, hideHeader }: DiffViewerProps) {
  const stats = computeDiffStats(diff);
  const isNew = isNewFile(diff);
  const patch = convertToPatchFormat(filePath, diff, lineOffset);

  // If no patch content, show a simple message
  if (!patch) {
    return (
      <div className={className}>
        <div className="flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2">
          <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{getFileName(filePath)}</span>
          <span className="text-xs text-muted-foreground">No changes</span>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* File header */}
      {!hideHeader && (
        <div className="flex items-center gap-2 rounded-t-lg bg-zinc-800 px-3 py-2">
          {isNew ? (
            <FilePlus className="h-4 w-4 shrink-0 text-green-500" />
          ) : (
            <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{getFileName(filePath)}</span>
          <DiffStats added={stats.added} removed={stats.removed} modified={stats.modified} isNew={isNew} />
        </div>
      )}

      {/* Diff content */}
      <div className={`diff-viewer-container overflow-hidden ${hideHeader ? "rounded-lg" : "rounded-b-lg"}`}>
        <DiffErrorBoundary
          fallback={<pre className="overflow-x-auto bg-zinc-900 p-3 text-xs text-muted-foreground">{diff}</pre>}
        >
          <PatchDiff
            patch={patch}
            options={{
              theme: "vitesse-dark",
              diffStyle: "unified",
              diffIndicators: "bars",
              lineDiffType: "word-alt",
              disableFileHeader: true,
              overflow: "scroll",
              unsafeCSS:
                ":host, [data-diffs], [data-line], [data-column-number] { --diffs-bg: transparent; } [data-column-number] { border-right: none !important; } pre { background: transparent !important; }",
            }}
          />
        </DiffErrorBoundary>
      </div>
    </div>
  );
}

interface DiffStatsProps {
  added: number;
  removed: number;
  modified: number;
  isNew: boolean;
}

function DiffStats({ added, removed, modified, isNew }: DiffStatsProps) {
  if (isNew) {
    return <span className="text-xs font-medium text-green-500">+{added}</span>;
  }

  return (
    <span className="flex items-center gap-1 text-xs font-medium">
      {added - modified > 0 && <span className="text-green-500">+{added - modified}</span>}
      {removed - modified > 0 && <span className="text-red-400">-{removed - modified}</span>}
      {modified > 0 && <span className="text-yellow-500">~{modified}</span>}
    </span>
  );
}

/**
 * Convert file content to a context-only patch format (all lines as unchanged context)
 * This allows displaying file content with correct line numbers starting at a specific offset
 */
function contentToContextPatch(filePath: string, content: string, startLine: number = 1): string {
  const lines = content.split("\n");
  const lineCount = lines.length;

  // Convert all lines to context lines (prefixed with space)
  const contextLines = lines.map((line) => ` ${line}`);

  const patchLines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -${startLine},${lineCount} +${startLine},${lineCount} @@`,
    ...contextLines,
  ];

  return patchLines.join("\n") + "\n";
}

/**
 * Simple file display for Write tool (new file creation) or Read tool (file viewing)
 * Uses the File component from @pierre/diffs for syntax highlighting
 * When startLine > 1, uses PatchDiff with context lines to show correct line numbers
 */
interface FileViewerProps {
  filePath: string;
  content: string;
  className?: string;
  hideHeader?: boolean;
  startLine?: number;
}

export function FileViewer({ filePath, content, className, hideHeader, startLine = 1 }: FileViewerProps) {
  const lineCount = content.split("\n").length;

  // When there's an offset, use PatchDiff to render with correct line numbers
  if (startLine > 1) {
    const contextPatch = contentToContextPatch(filePath, content, startLine);

    return (
      <div className={className}>
        {/* File header */}
        {!hideHeader && (
          <div className="flex items-center gap-2 rounded-t-lg bg-zinc-800 px-3 py-2">
            <FilePlus className="h-4 w-4 shrink-0 text-green-500" />
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{getFileName(filePath)}</span>
            <span className="text-xs font-medium text-green-500">+{lineCount}</span>
          </div>
        )}

        {/* File content with offset line numbers */}
        <div className={`file-viewer-container overflow-hidden ${hideHeader ? "rounded-lg" : "rounded-b-lg"}`}>
          <DiffErrorBoundary
            fallback={<pre className="overflow-x-auto bg-zinc-900 p-3 text-xs text-muted-foreground">{content}</pre>}
          >
            <PatchDiff
              patch={contextPatch}
              options={{
                theme: "vitesse-dark",
                diffStyle: "unified",
                diffIndicators: "none",
                disableFileHeader: true,
                disableBackground: true,
                overflow: "scroll",
                unsafeCSS:
                  ":host, [data-diffs], [data-line], [data-column-number] { --diffs-bg: transparent; } [data-column-number] { border-right: none !important; } pre { background: transparent !important; } [data-separator] { display: none !important; }",
              }}
            />
          </DiffErrorBoundary>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* File header */}
      {!hideHeader && (
        <div className="flex items-center gap-2 rounded-t-lg bg-zinc-800 px-3 py-2">
          <FilePlus className="h-4 w-4 shrink-0 text-green-500" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{getFileName(filePath)}</span>
          <span className="text-xs font-medium text-green-500">+{lineCount}</span>
        </div>
      )}

      {/* File content */}
      <div className={`file-viewer-container overflow-hidden ${hideHeader ? "rounded-lg" : "rounded-b-lg"}`}>
        <DiffErrorBoundary
          fallback={<pre className="overflow-x-auto bg-zinc-900 p-3 text-xs text-muted-foreground">{content}</pre>}
        >
          <File
            file={{
              name: getFileName(filePath),
              contents: content,
            }}
            options={{
              theme: "vitesse-dark",
              overflow: "scroll",
              disableFileHeader: true,
              unsafeCSS:
                ":host, [data-diffs], [data-line], [data-column-number] { --diffs-bg: transparent; } [data-column-number] { border-right: none !important; } pre { background: transparent !important; }",
            }}
          />
        </DiffErrorBoundary>
      </div>
    </div>
  );
}

/**
 * Bash command display component
 */
interface BashCommandProps {
  command: string;
  className?: string;
}

export function BashCommand({ command, className }: BashCommandProps) {
  return (
    <div className={`flex items-center gap-2 rounded-lg bg-zinc-800 px-3 py-2 ${className || ""}`}>
      <SquareTerminal className="h-4 w-4 shrink-0 text-muted-foreground" />
      <code className="min-w-0 flex-1 truncate font-mono text-sm text-muted-foreground">{command}</code>
    </div>
  );
}

/**
 * Code block with syntax highlighting
 * Uses the File component from @pierre/diffs for syntax highlighting
 */
interface CodeBlockProps {
  content: string;
  language?: string;
  className?: string;
}

export function CodeBlock({ content, language = "bash", className }: CodeBlockProps) {
  // Map language to a fake filename for syntax detection
  const filename = language === "bash" || language === "shell" ? "command.sh" : `file.${language}`;

  return (
    <div className={`code-block-container overflow-hidden ${className || ""}`}>
      <DiffErrorBoundary
        fallback={
          <pre className="overflow-x-auto text-[13px] leading-5 whitespace-pre-wrap text-[#dbd7caee]">{content}</pre>
        }
      >
        <File
          file={{
            name: filename,
            contents: content,
          }}
          options={{
            theme: "vitesse-dark",
            overflow: "scroll",
            disableFileHeader: true,
            disableLineNumbers: true,
            unsafeCSS:
              ":host, [data-diffs], [data-line] { --diffs-bg: transparent; } pre { background: transparent !important; } [data-code] { padding-top: 0 !important; padding-bottom: 0 !important; }",
          }}
        />
      </DiffErrorBoundary>
    </div>
  );
}

/**
 * Shell output renderer that detects and highlights diff sections
 */
interface ShellOutputProps {
  content: string;
  className?: string;
}

type OutputSegment = {
  type: "text" | "diff";
  content: string;
};

/**
 * Split shell output into text and diff segments
 * Detects git diff output by looking for "diff --git" markers
 */
function splitShellOutput(content: string): OutputSegment[] {
  const segments: OutputSegment[] = [];
  const lines = content.split("\n");

  let currentSegment: OutputSegment | null = null;
  let inDiff = false;

  for (const line of lines) {
    const isDiffStart = line.startsWith("diff --git ");
    const isDiffLine =
      inDiff &&
      (line.startsWith("index ") ||
        line.startsWith("--- ") ||
        line.startsWith("+++ ") ||
        line.startsWith("@@ ") ||
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ") ||
        line === "");

    // Check if we're exiting a diff (non-diff line after being in diff)
    const isExitingDiff = inDiff && !isDiffStart && !isDiffLine && line.trim() !== "";

    if (isDiffStart) {
      // Starting a new diff section
      if (currentSegment && currentSegment.content) {
        segments.push(currentSegment);
      }
      currentSegment = { type: "diff", content: line };
      inDiff = true;
    } else if (isExitingDiff) {
      // Exiting diff, start text section
      if (currentSegment && currentSegment.content) {
        segments.push(currentSegment);
      }
      currentSegment = { type: "text", content: line };
      inDiff = false;
    } else if (inDiff) {
      // Continue diff section
      currentSegment!.content += "\n" + line;
    } else {
      // Text section
      if (!currentSegment || currentSegment.type !== "text") {
        if (currentSegment && currentSegment.content) {
          segments.push(currentSegment);
        }
        currentSegment = { type: "text", content: line };
      } else {
        currentSegment.content += "\n" + line;
      }
    }
  }

  // Push final segment
  if (currentSegment && currentSegment.content) {
    segments.push(currentSegment);
  }

  return segments;
}

export function ShellOutput({ content, className }: ShellOutputProps) {
  const segments = splitShellOutput(content);

  // If no diff segments, just render as plain text
  if (segments.every((s) => s.type === "text")) {
    return <CodeBlock content={content} language="txt" className={className} />;
  }

  return (
    <div className={className}>
      {segments.map((segment, i) => (
        <CodeBlock key={i} content={segment.content} language={segment.type === "diff" ? "diff" : "txt"} />
      ))}
    </div>
  );
}

/**
 * Parse ripgrep output into structured chunks
 * Format: "line_num: content" for matches, "line_num- content" for context, "--" for separators
 */
interface GrepChunk {
  filePath: string | null;
  lines: Array<{ lineNum: number; content: string; isMatch: boolean }>;
  startLine: number;
}

function parseGrepContent(content: string, inputPath?: string): GrepChunk[] {
  const chunks: GrepChunk[] = [];
  const rawChunks = content.split(/^--$/m);

  for (const rawChunk of rawChunks) {
    const lines = rawChunk.split("\n").filter((l) => l.trim());
    if (lines.length === 0) continue;

    const chunkLines: GrepChunk["lines"] = [];
    let filePath: string | null = null;
    let minLine = Infinity;

    for (const line of lines) {
      // Try to match: [filename:]line_num[:|-]content
      // The : after line_num indicates a match, - indicates context
      const match = line.match(/^(?:([^:]+):)?(\d+)([:|-])(.*)$/);
      if (match) {
        const [, file, lineNumStr, separator, lineContent] = match;
        const lineNum = parseInt(lineNumStr, 10);
        const isMatch = separator === ":";

        if (file && !filePath) {
          filePath = file;
        }

        minLine = Math.min(minLine, lineNum);
        chunkLines.push({ lineNum, content: lineContent, isMatch });
      }
    }

    if (chunkLines.length > 0) {
      chunks.push({
        filePath: filePath || inputPath || null,
        lines: chunkLines,
        startLine: minLine === Infinity ? 1 : minLine,
      });
    }
  }

  return chunks;
}

/**
 * Grep content viewer for displaying ripgrep output with syntax highlighting
 */
interface GrepContentViewerProps {
  content: string;
  inputPath?: string;
  className?: string;
}

export function GrepContentViewer({ content, inputPath, className }: GrepContentViewerProps) {
  const chunks = parseGrepContent(content, inputPath);

  if (chunks.length === 0) {
    return <CodeBlock content={content} language="txt" className={className} />;
  }

  return (
    <div className={`space-y-2 ${className || ""}`}>
      {chunks.map((chunk, i) => {
        const filePath = chunk.filePath || "file.txt";
        const chunkContent = chunk.lines.map((l) => l.content).join("\n");

        return (
          <div key={i} className="overflow-hidden rounded-lg border border-border/50 bg-zinc-900/30">
            {chunk.filePath && (
              <div className="bg-zinc-800/50 px-3 py-1.5">
                <span className="truncate text-sm text-muted-foreground">{chunk.filePath}</span>
              </div>
            )}
            <FileViewer filePath={filePath} content={chunkContent} startLine={chunk.startLine} hideHeader />
          </div>
        );
      })}
    </div>
  );
}
