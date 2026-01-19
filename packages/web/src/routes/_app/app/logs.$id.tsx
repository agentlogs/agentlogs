import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import type { UnifiedTranscriptMessage } from "@agentlogs/shared/claudecode";
import { unifiedTranscriptSchema } from "@agentlogs/shared/schemas";
import {
  ChevronDown,
  Clock,
  FileText,
  Folder,
  GitBranch,
  Globe,
  Loader2,
  Lock,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Terminal,
  Users,
} from "lucide-react";
import { ClaudeCodeIcon, CodexIcon, GitHubIcon, OpenCodeIcon } from "../../../components/icons/source-icons";
import { CodeBlock, DiffViewer, FileViewer, ShellOutput } from "../../../components/diff-viewer";
import { useEffect, useState } from "react";
import { MarkdownRenderer } from "../../../components/markdown-renderer";

import {
  extractImageReferences,
  replaceImageReferencesForDisplay,
  type ImageReference,
} from "../../../lib/message-utils";
import { getTranscript, updateVisibility } from "../../../lib/server-functions";

export const Route = createFileRoute("/_app/app/logs/$id")({
  loader: ({ params }) => getTranscript({ data: params.id }),
  // Cache preloaded data so hover-prefetch is effective
  staleTime: 30_000, // Data fresh for 30s (covers hover → click)
  gcTime: 5 * 60_000, // Keep in cache 5min for back navigation
  pendingComponent: TranscriptPendingComponent,
  pendingMinMs: 100, // Only show loading if takes > 100ms (avoids flash)
  component: TranscriptDetailComponent,
});

function TranscriptPendingComponent() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-sm text-muted-foreground">Loading transcript...</p>
      </div>
    </div>
  );
}

function formatTimeAgo(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffMonths > 0) return `${diffMonths}mo ago`;
  if (diffWeeks > 0) return `${diffWeeks}w ago`;
  if (diffDays > 0) return `${diffDays}d ago`;
  if (diffHours > 0) return `${diffHours}h ago`;
  if (diffMinutes > 0) return `${diffMinutes}m ago`;
  return "just now";
}

function getSourceIcon(source: string, className?: string) {
  switch (source) {
    case "codex":
      return <CodexIcon className={className} />;
    case "claude-code":
      return <ClaudeCodeIcon className={className} />;
    case "opencode":
      return <OpenCodeIcon className={className} />;
    default:
      return <Terminal className={className} />;
  }
}

function getModelDisplayName(model: string | null): string {
  if (!model) return "Unknown";

  // Parse model strings like:
  // - claude-opus-4-5-20251101 → Claude Opus 4.5
  // - claude-sonnet-4-20250514 → Claude Sonnet 4
  // - claude-3-5-haiku-20241022 → Claude Haiku 3.5
  const match = model.match(/^claude-(?:(\d+)-(\d+)-)?(opus|sonnet|haiku)(?:-(\d+)(?:-(\d+))?)?-\d{8}$/);
  if (!match) return model;

  const [, oldMajor, oldMinor, family, newMajor, newMinor] = match;
  const major = newMajor ?? oldMajor;
  const minor = newMinor ?? oldMinor;
  const version = minor ? `${major}.${minor}` : major;
  const familyName = family.charAt(0).toUpperCase() + family.slice(1);

  return `Claude ${familyName} ${version}`;
}

function formatRepoName(repo: string): { label: string; isGitHub: boolean } {
  if (repo.startsWith("github.com/")) {
    return { label: repo.replace("github.com/", ""), isGitHub: true };
  }
  return { label: repo, isGitHub: false };
}

// Check if text is an internal system message (for filtering)
// Note: Most internal messages are now filtered at ingest time in claudecode.ts
// This is kept as a fallback for any edge cases
function isInternalMessage(text: string): boolean {
  const internalPatterns = [/^<local-command-caveat>.*<\/local-command-caveat>/s];
  const trimmed = text.trim();
  return internalPatterns.some((pattern) => pattern.test(trimmed));
}

// Get user messages with their indices for navigation
function getUserMessagesWithIndices(messages: UnifiedTranscriptMessage[]): Array<{ index: number; text: string }> {
  const result: Array<{ index: number; text: string }> = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.type === "user" && !isInternalMessage(msg.text)) {
      result.push({ index: i, text: msg.text });
    } else if (msg.type === "command") {
      result.push({ index: i, text: msg.name });
    }
  }
  return result;
}

function TranscriptDetailComponent() {
  const data = Route.useLoaderData();

  // Parse and validate the unified transcript
  const unifiedTranscript = unifiedTranscriptSchema.parse(data.unifiedTranscript);
  const timeAgo = formatTimeAgo(new Date(data.createdAt));
  const userMessages = getUserMessagesWithIndices(unifiedTranscript.messages);
  const repoInfo = unifiedTranscript.git?.repo ? formatRepoName(unifiedTranscript.git.repo) : null;

  const pageTitle = data.summary || unifiedTranscript.preview || "Untitled Thread";

  // Set document title
  useEffect(() => {
    document.title = `${pageTitle} - Agent Logs`;
  }, [pageTitle]);

  // Auto-scroll to message if hash is present in URL (instant, no animation)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const target = document.querySelector(hash);
      if (target) {
        const rect = target.getBoundingClientRect();
        const scrollTop = window.scrollY + rect.top - 16;
        window.scrollTo({ top: scrollTop, behavior: "instant" });
      }
    }
  }, []);

  return (
    <div className="flex gap-8">
      {/* Main Content */}
      <div className="min-w-0 flex-1">
        {/* Header with lines changed */}
        <header className="mb-1 flex items-baseline gap-3">
          <h1 className="min-w-0 truncate font-serif text-3xl font-semibold tracking-wide">{pageTitle}</h1>
          {(data.linesAdded > 0 || data.linesRemoved > 0 || data.linesModified > 0) && (
            <span className="flex shrink-0 items-center gap-1 text-sm">
              {data.linesAdded > 0 && <span className="text-green-500">+{data.linesAdded}</span>}
              {data.linesModified > 0 && <span className="text-yellow-500">~{data.linesModified}</span>}
              {data.linesRemoved > 0 && <span className="text-red-400">-{data.linesRemoved}</span>}
            </span>
          )}
        </header>

        {/* Log Metadata */}
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
          {/* Author */}
          <div className="flex items-center gap-1.5">
            <img src={data.userImage || undefined} alt={data.userName || "User"} className="h-4 w-4 rounded-full" />
            <span>{data.userName || "Unknown"}</span>
          </div>
          {/* Change time */}
          <div className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            <span>{timeAgo}</span>
          </div>
          {/* Visibility */}
          <VisibilitySection transcriptId={data.id} visibility={data.visibility} isOwner={data.isOwner} />
          {/* Model */}
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex cursor-default items-center gap-1.5">
                {getSourceIcon(data.source, "h-4 w-4")}
                <span>{getModelDisplayName(unifiedTranscript.model)}</span>
              </div>
            </TooltipTrigger>
            {unifiedTranscript.model && <TooltipContent side="bottom">{unifiedTranscript.model}</TooltipContent>}
          </Tooltip>
          {/* Git */}
          {repoInfo &&
            (repoInfo.isGitHub ? (
              <a
                href={`https://github.com/${repoInfo.label}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 transition-colors hover:text-foreground"
              >
                <GitHubIcon className="h-4 w-4" />
                <span>
                  {repoInfo.label}
                  {unifiedTranscript.git?.branch && `:${unifiedTranscript.git.branch}`}
                </span>
              </a>
            ) : (
              <div className="flex items-center gap-1.5">
                <Folder className="h-4 w-4" />
                <span>
                  {repoInfo.label}
                  {unifiedTranscript.git?.branch && `:${unifiedTranscript.git.branch}`}
                </span>
              </div>
            ))}
          {!repoInfo && unifiedTranscript.git?.branch && (
            <div className="flex items-center gap-1.5">
              <GitBranch className="h-4 w-4" />
              <span>{unifiedTranscript.git.branch}</span>
            </div>
          )}
        </div>

        {/* Messages */}
        <div className="space-y-4">
          {unifiedTranscript.messages.map((message, i) => (
            <MessageBlock key={i} message={message} index={i} isAdmin={data.isAdmin} />
          ))}
        </div>
      </div>

      {/* Sidebar - vertically centered TOC with independent scroll */}
      <aside className="sticky top-0 hidden h-screen w-56 shrink-0 lg:flex lg:items-center">
        <div className="max-h-[80vh] space-y-6 overflow-y-auto">
          {/* User Prompts Navigation */}
          {userMessages.length > 0 && (
            <PromptsList userMessages={userMessages} totalMessages={unifiedTranscript.messages.length} />
          )}
          {/* Commits */}
          {data.commits && data.commits.length > 0 && (
            <CommitTimeline
              commits={data.commits}
              repoUrl={unifiedTranscript.git?.repo}
              branch={data.commits[0]?.branch || unifiedTranscript.git?.branch || undefined}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

function PromptsList({
  userMessages,
  totalMessages,
}: {
  userMessages: Array<{ index: number; text: string }>;
  totalMessages: number;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(userMessages[0]?.index ?? null);

  // Calculate response length after each user message and map to mask percentage
  const getMaskClass = (i: number): string => {
    const currentIndex = userMessages[i].index;
    const nextIndex = userMessages[i + 1]?.index ?? totalMessages;
    const responseLength = nextIndex - currentIndex - 1;

    // Map response length to mask percentage buckets (15% gradient width, variable endpoint)
    if (responseLength <= 3) return "[mask-image:linear-gradient(to_right,black_0%,black_50%,transparent_65%)]";
    if (responseLength <= 8) return "[mask-image:linear-gradient(to_right,black_0%,black_55%,transparent_70%)]";
    if (responseLength <= 15) return "[mask-image:linear-gradient(to_right,black_0%,black_60%,transparent_75%)]";
    if (responseLength <= 25) return "[mask-image:linear-gradient(to_right,black_0%,black_65%,transparent_80%)]";
    return "[mask-image:linear-gradient(to_right,black_0%,black_70%,transparent_85%)]";
  };

  // Track which message is closest to the top of the viewport
  useEffect(() => {
    if (userMessages.length === 0) return;

    const handleScroll = () => {
      // Target line is 25% from the top of the viewport
      const targetY = window.innerHeight * 0.25;
      let closestIndex = userMessages[0]?.index ?? null;
      let closestDistance = Infinity;

      for (const msg of userMessages) {
        const messageId = `msg-${msg.index + 1}`;
        const element = document.getElementById(messageId);
        if (!element) continue;

        const rect = element.getBoundingClientRect();
        // Distance from the top of the element to our target line
        // We want the message whose top is at or just above the target line
        const distance = Math.abs(rect.top - targetY);

        // Prefer messages that have scrolled past the target (negative = above target)
        const adjustedDistance = rect.top <= targetY ? distance : distance + 10000;

        if (adjustedDistance < closestDistance) {
          closestDistance = adjustedDistance;
          closestIndex = msg.index;
        }
      }

      setActiveIndex(closestIndex);
    };

    // Initial calculation
    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [userMessages]);

  const scrollToMessage = (index: number) => {
    const messageId = `msg-${index + 1}`;
    const target = document.getElementById(messageId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const padLength = String(userMessages.length).length;

  return (
    <section>
      <div className="mb-2 text-xs font-medium text-muted-foreground">Prompts</div>
      <div className="space-y-0.5">
        {userMessages.map((msg, i) => (
          <button
            key={msg.index}
            onClick={() => scrollToMessage(msg.index)}
            className={`block w-full overflow-hidden py-1 text-left text-sm whitespace-nowrap transition-colors hover:text-foreground ${getMaskClass(i)} ${
              activeIndex === msg.index ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <span className="mr-2 text-muted-foreground/60 tabular-nums">{String(i + 1).padStart(padLength, "0")}</span>
            {msg.text}
          </button>
        ))}
      </div>
    </section>
  );
}

interface Commit {
  sha: string;
  title: string | null;
  branch: string | null;
  timestamp: string;
}

function formatCommitTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) return `${diffDays}d`;
  if (diffHours > 0) return `${diffHours}h`;
  if (diffMinutes > 0) return `${diffMinutes}m`;
  return "now";
}

function CommitTimeline({
  commits,
  repoUrl,
  branch,
}: {
  commits: Commit[];
  repoUrl?: string | null;
  branch?: string | null;
}) {
  const isGitHub = repoUrl?.startsWith("github.com/");
  const getCommitUrl = (sha: string) => (isGitHub ? `https://${repoUrl}/commit/${sha}` : null);

  // Keep chronological order (oldest first)
  const sortedCommits = commits;

  return (
    <section>
      <div className="mb-2 text-xs font-medium text-muted-foreground">Commits</div>

      {/* Branch label */}
      {branch && (
        <div className="relative z-10 inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs font-medium text-foreground">
          <GitBranch className="h-3.5 w-3.5" />
          {branch}
        </div>
      )}

      {/* Timeline */}
      <div className="relative ml-2.5 pl-4.75">
        {/* Vertical line */}
        <div className="absolute top-0 bottom-1 left-[7px] w-0.5 -translate-y-1.5 bg-border" />

        {/* Commits */}
        <div>
          {sortedCommits.map((commit, i) => {
            const commitUrl = getCommitUrl(commit.sha);
            const timeAgo = formatCommitTime(commit.timestamp);
            const title = commit.title || commit.sha.slice(0, 7);

            const commitContent = (
              <>
                {/* Dot */}
                <div className="absolute top-1/2 -left-4 -translate-y-1/2">
                  <div className="h-2.5 w-2.5 rounded-full border-2 border-border bg-background" />
                </div>
                {/* Content */}
                <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground">{title}</span>
                <span className="shrink-0 text-muted-foreground/60">{timeAgo}</span>
              </>
            );

            return commitUrl ? (
              <a
                key={i}
                href={commitUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="relative flex gap-2 py-1 pl-1 text-xs transition-colors hover:text-primary"
              >
                {commitContent}
              </a>
            ) : (
              <div key={i} className="relative flex gap-2 py-1 pl-1 text-xs">
                {commitContent}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function getVisibilityIcon(visibility: string) {
  switch (visibility) {
    case "public":
      return <Globe className="h-4 w-4" />;
    case "team":
      return <Users className="h-4 w-4" />;
    case "private":
    default:
      return <Lock className="h-4 w-4" />;
  }
}

function getVisibilityLabel(visibility: string) {
  switch (visibility) {
    case "public":
      return "Public";
    case "team":
      return "Team";
    case "private":
    default:
      return "Private";
  }
}

interface VisibilitySectionProps {
  transcriptId: string;
  visibility: string;
  isOwner: boolean;
}

function VisibilitySection({ transcriptId, visibility, isOwner }: VisibilitySectionProps) {
  const router = useRouter();
  const [currentVisibility, setCurrentVisibility] = useState(visibility);
  const [isUpdating, setIsUpdating] = useState(false);
  const [showLoading, setShowLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleVisibilityChange = async (newVisibility: string) => {
    if (newVisibility === currentVisibility) return;

    setIsUpdating(true);
    setShowLoading(true);
    setError(null);

    const minDisplayPromise = new Promise((resolve) => setTimeout(resolve, 200));

    try {
      await Promise.all([updateVisibility({ data: { transcriptId, visibility: newVisibility } }), minDisplayPromise]);
      setCurrentVisibility(newVisibility);
      router.invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update visibility");
      setCurrentVisibility(currentVisibility);
    } finally {
      setIsUpdating(false);
      setShowLoading(false);
    }
  };

  return (
    <>
      {isOwner ? (
        <Select value={currentVisibility} onValueChange={handleVisibilityChange} disabled={isUpdating}>
          <SelectTrigger className="h-auto gap-1 border-0 bg-transparent p-0 shadow-none hover:bg-transparent focus:ring-0 dark:bg-transparent dark:hover:bg-transparent">
            <div className="flex items-center gap-1.5">
              {showLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : error ? (
                <span className="text-destructive" title={error}>
                  {getVisibilityIcon(currentVisibility)}
                </span>
              ) : (
                getVisibilityIcon(currentVisibility)
              )}
              <span className={error ? "text-destructive" : ""}>{getVisibilityLabel(currentVisibility)}</span>
            </div>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="private">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Lock className="h-4 w-4" />
                <span>Private</span>
              </div>
            </SelectItem>
            <SelectItem value="team">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Users className="h-4 w-4" />
                <span>Team</span>
              </div>
            </SelectItem>
            <SelectItem value="public">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Globe className="h-4 w-4" />
                <span>Public</span>
              </div>
            </SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <div className="flex items-center gap-1.5">
          {getVisibilityIcon(visibility)}
          <span>{getVisibilityLabel(visibility)}</span>
        </div>
      )}
    </>
  );
}

function ImageGallery({ images }: { images: ImageReference[] }) {
  if (images.length === 0) return null;

  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {images.map((img) => (
        <a
          key={img.sha256}
          href={`/api/blobs/${img.sha256}`}
          target="_blank"
          rel="noopener noreferrer"
          className="block"
        >
          <img
            src={`/api/blobs/${img.sha256}`}
            alt={`Image ${img.sha256.slice(0, 8)}`}
            className="max-h-90 max-w-full rounded-lg border border-border object-contain hover:border-border/80"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}

// Get icon for tool type
function getToolIcon(toolName: string | null): React.ComponentType<{ className?: string }> {
  switch (toolName) {
    case "Bash":
    case "BashOutput":
      return SquareTerminal;
    case "Read":
      return FileText;
    case "Write":
    case "Edit":
      return Pencil;
    case "Glob":
      return Folder;
    case "Grep":
    case "WebSearch":
      return Search;
    case "WebFetch":
      return Globe;
    case "Task":
      return Sparkles;
    default:
      return Terminal;
  }
}

// Get tool description from input (for display in the collapsed view)
function getToolDescription(toolName: string | null, input: unknown): string {
  if (!toolName) return "";

  const inputObj = input as Record<string, unknown> | undefined;

  switch (toolName) {
    case "Read":
    case "Write":
    case "Edit":
      return inputObj?.file_path ? String(inputObj.file_path) : "";
    case "Glob":
      return inputObj?.pattern ? String(inputObj.pattern) : "";
    case "Grep":
      return inputObj?.pattern ? String(inputObj.pattern) : "";
    case "Bash":
      return inputObj?.command ? String(inputObj.command) : "";
    case "Task":
      return inputObj?.prompt ? String(inputObj.prompt) : "";
    case "WebFetch":
      return inputObj?.url ? String(inputObj.url) : "";
    case "WebSearch":
      return inputObj?.query ? String(inputObj.query) : "";
    default:
      return "";
  }
}

interface MessageBlockProps {
  message: UnifiedTranscriptMessage;
  index: number;
  isAdmin?: boolean;
}

function MessageBlock({ message, index, isAdmin }: MessageBlockProps) {
  const messageId = `msg-${index + 1}`;

  // User message - dark pill with avatar
  if (message.type === "user") {
    // Skip internal system messages
    if (isInternalMessage(message.text)) {
      return null;
    }

    const userImages = message.images ?? [];

    return (
      <div id={messageId} className="flex min-w-0 scroll-mt-4 items-start gap-3">
        <div className="min-w-0 rounded-lg bg-secondary/60 px-4 py-2.5">
          <p className="text-sm break-all whitespace-pre-wrap">{message.text}</p>
          <ImageGallery images={userImages} />
        </div>
      </div>
    );
  }

  // Thinking block - collapsible
  if (message.type === "thinking") {
    return <ThinkingBlock messageId={messageId} text={message.text} />;
  }

  // Tool call - collapsible with icon
  if (message.type === "tool-call") {
    return (
      <ToolCallBlock
        messageId={messageId}
        toolName={message.toolName}
        input={message.input}
        output={message.output}
        error={message.error}
        isError={message.isError}
        isAdmin={isAdmin}
      />
    );
  }

  // Agent response - rendered text
  if (message.type === "agent") {
    return (
      <div id={messageId} className="prose prose-invert prose-sm max-w-none scroll-mt-4">
        <MarkdownRenderer className="text-sm">{message.text}</MarkdownRenderer>
      </div>
    );
  }

  // Compaction summary
  if (message.type === "compaction-summary") {
    return (
      <div id={messageId} className="scroll-mt-4 text-sm text-muted-foreground italic">
        {message.text}
      </div>
    );
  }

  // Command (slash command)
  if (message.type === "command") {
    return (
      <div id={messageId} className="flex scroll-mt-4 items-start gap-3">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/60">
          <Terminal className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="rounded-lg bg-secondary/60 px-4 py-2.5">
          <code className="font-mono text-sm">
            {message.name}
            {message.args && <span className="text-muted-foreground"> {message.args}</span>}
          </code>
          {message.output && (
            <pre className="mt-2 text-xs whitespace-pre-wrap text-muted-foreground">{message.output}</pre>
          )}
        </div>
      </div>
    );
  }

  return null;
}

function ThinkingBlock({ messageId, text }: { messageId: string; text: string }) {
  return (
    <Collapsible id={messageId} defaultOpen={false} className="group scroll-mt-4">
      <CollapsibleTrigger className="flex w-full items-center gap-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <span>Thinking</span>
        <ChevronDown className="h-4 w-4 transition-transform group-data-[open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-lg border border-border/50 bg-muted/30 p-4 text-muted-foreground">
          <MarkdownRenderer className="prose prose-invert prose-sm max-w-none">{text}</MarkdownRenderer>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

interface ToolCallBlockProps {
  messageId: string;
  toolName: string | null;
  input: unknown;
  output: unknown;
  error?: string;
  isError?: boolean | string;
  isAdmin?: boolean;
}

// Parse diff to count additions, deletions, and modifications
function parseDiffStats(diff: string): { added: number; removed: number; modified: number } {
  const lines = diff.split("\n");
  let added = 0;
  let removed = 0;
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) added++;
    else if (line.startsWith("-") && !line.startsWith("---")) removed++;
  }
  // If there are both additions and removals, some are likely modifications
  const modified = Math.min(added, removed);
  return { added, removed, modified };
}

// Convert file content to diff format (all lines as additions for new files)
function contentToDiff(content: string): string {
  return content
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n");
}

// Get display name for tool (some tools have different display names)
function getToolDisplayName(toolName: string | null): string {
  if (toolName === "Bash") return "Shell";
  return toolName || "Tool";
}

// Debug section for admins - shows raw JSON data
function AdminDebugSection({ input, output, error }: { input: unknown; output: unknown; error?: string }) {
  return (
    <Collapsible
      defaultOpen={false}
      className="m-3 rounded-lg border border-dashed border-yellow-500/30 bg-yellow-950/10"
    >
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs">
        <span className="font-medium text-yellow-500">🔧 Debug</span>
        <span className="text-yellow-500/60">(admin only)</span>
        <ChevronDown className="ml-auto h-3 w-3 text-yellow-500/60 transition-transform group-data-[open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 px-3 pb-3">
          {input != null && (
            <div>
              <div className="mb-1 text-xs font-medium text-yellow-500/80">Input</div>
              <pre className="overflow-x-auto rounded bg-black/40 p-2 font-mono text-xs text-yellow-100/70">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {output != null && (
            <div>
              <div className="mb-1 text-xs font-medium text-yellow-500/80">Output</div>
              <pre className="overflow-x-auto rounded bg-black/40 p-2 font-mono text-xs text-yellow-100/70">
                {JSON.stringify(output, null, 2)}
              </pre>
            </div>
          )}
          {error && (
            <div>
              <div className="mb-1 text-xs font-medium text-yellow-500/80">Error</div>
              <pre className="overflow-x-auto rounded bg-black/40 p-2 font-mono text-xs text-red-300">{error}</pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ToolCallBlock({ messageId, toolName, input, output, error, isError, isAdmin }: ToolCallBlockProps) {
  const Icon = getToolIcon(toolName);
  const description = getToolDescription(toolName, input);
  const displayName = getToolDisplayName(toolName);

  // Extract images from input/output
  const inputImages = extractImageReferences(input);
  const outputImages = extractImageReferences(output);

  const inputObj = input as Record<string, unknown> | undefined;
  const outputObj = output as Record<string, unknown> | undefined;
  const fileObj = outputObj?.file as Record<string, unknown> | undefined;
  const isEditWithDiff = toolName === "Edit" && !!inputObj?.file_path && !!inputObj?.diff;
  const isWriteWithContent = toolName === "Write" && !!inputObj?.file_path && !!inputObj?.content;
  const isReadWithContent = toolName === "Read" && !!inputObj?.file_path && !!fileObj?.content;
  const isBashWithCommand = toolName === "Bash" && !!inputObj?.command;
  const isGrepWithFilenames = toolName === "Grep" && Array.isArray(outputObj?.filenames);

  // Calculate diff stats for Edit tool
  const diffStats = isEditWithDiff ? parseDiffStats(String(inputObj!.diff)) : null;

  // Calculate line count for Write tool
  const writeLineCount = isWriteWithContent ? String(inputObj!.content).split("\n").length : 0;

  // For Bash, use description if available, otherwise truncated command
  const bashDescription = isBashWithCommand
    ? inputObj?.description
      ? String(inputObj.description)
      : String(inputObj!.command)
    : "";

  // Determine file path for file-based tools (strip ./ prefix for cleaner display)
  const filePath = inputObj?.file_path ? String(inputObj.file_path).replace(/^\.\//, "") : "";

  // Common styles
  const collapsibleClassName =
    "scroll-mt-4 group overflow-hidden rounded-lg border border-border bg-zinc-900/50 transition-colors hover:border-muted-foreground/30";
  const triggerClassName = "flex w-full items-center gap-3 px-3 py-2 text-left";

  // For Edit/Write tools, wrap DiffViewer/FileViewer in collapsible
  if (isEditWithDiff || isWriteWithContent) {
    return (
      <Collapsible id={messageId} defaultOpen={!(error || isError)} className={collapsibleClassName}>
        <CollapsibleTrigger className={triggerClassName}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{displayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{filePath}</span>
          {diffStats && !error && !isError && (
            <span className="flex shrink-0 items-center gap-1 text-sm">
              {diffStats.added - diffStats.modified > 0 && (
                <span className="text-green-500">+{diffStats.added - diffStats.modified}</span>
              )}
              {diffStats.removed - diffStats.modified > 0 && (
                <span className="text-red-400">-{diffStats.removed - diffStats.modified}</span>
              )}
              {diffStats.modified > 0 && <span className="text-yellow-500">~{diffStats.modified}</span>}
            </span>
          )}
          {isWriteWithContent && !error && !isError && (
            <span className="shrink-0 text-sm text-green-500">+{writeLineCount}</span>
          )}
          {(error || isError) && (
            <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div>
            {isEditWithDiff && (
              <DiffViewer
                filePath={filePath}
                diff={String(inputObj!.diff)}
                lineOffset={typeof inputObj!.lineOffset === "number" ? inputObj!.lineOffset : undefined}
                hideHeader
              />
            )}
            {isWriteWithContent && (
              <DiffViewer filePath={filePath} diff={contentToDiff(String(inputObj!.content))} hideHeader />
            )}
            {(error || isError) && (
              <div className="m-3 rounded-lg bg-destructive/10 p-3">
                <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
                <pre className="text-xs text-destructive">{error || "Operation failed"}</pre>
              </div>
            )}
            {isAdmin && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // For Read tool with file content
  if (isReadWithContent) {
    const fileContent = String(fileObj!.content);
    const lineCount = fileObj?.numLines ? Number(fileObj.numLines) : fileContent.split("\n").length;

    return (
      <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
        <CollapsibleTrigger className={triggerClassName}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{displayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{filePath}</span>
          <span className="shrink-0 text-sm text-muted-foreground">{lineCount} lines</span>
          {(error || isError) && (
            <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div>
            <FileViewer filePath={filePath} content={fileContent} hideHeader />
            {(error || isError) && (
              <div className="m-3 rounded-lg bg-destructive/10 p-3">
                <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
                <pre className="text-xs text-destructive">{error || "Operation failed"}</pre>
              </div>
            )}
            {isAdmin && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // For Grep results with filenames
  if (isGrepWithFilenames) {
    const filenames = outputObj!.filenames as string[];

    return (
      <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
        <CollapsibleTrigger className={triggerClassName}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{displayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{description}</span>
          <span className="shrink-0 text-sm text-muted-foreground">{filenames.length} files</span>
          {(error || isError) && (
            <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-3 py-2">
            <ul className="space-y-1 text-sm">
              {filenames.map((filename, i) => (
                <li key={i} className="flex items-center gap-2 text-muted-foreground">
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{filename}</span>
                </li>
              ))}
            </ul>
            {error && (
              <div className="mt-3">
                <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
                <pre className="overflow-x-auto rounded-md bg-destructive/10 p-3 font-mono text-xs whitespace-pre-wrap text-destructive">
                  {error}
                </pre>
              </div>
            )}
            {isAdmin && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // For Bash commands
  if (isBashWithCommand) {
    return (
      <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
        <CollapsibleTrigger className={triggerClassName}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{displayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{bashDescription}</span>
          {(error || isError) && (
            <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-3">
            <CodeBlock content={String(inputObj!.command)} language="bash" />
            {outputObj?.stdout ? <ShellOutput content={String(outputObj.stdout)} /> : null}
            {outputObj?.stderr ? <CodeBlock content={String(outputObj.stderr)} language="txt" /> : null}
            {error && <CodeBlock content={error} language="txt" />}
            {typeof output === "string" && output && <ShellOutput content={output} />}
            {isAdmin && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Default collapsible view for other tools
  return (
    <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
      <CollapsibleTrigger className={triggerClassName}>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-medium">{displayName}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{description}</span>
        {(error || isError) && (
          <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-3 p-3">
          {input != null ? (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Input</div>
              <pre className="overflow-x-auto rounded-md bg-black/30 p-3 text-xs">
                {String(JSON.stringify(replaceImageReferencesForDisplay(input), null, 2) ?? "")}
              </pre>
              <ImageGallery images={inputImages} />
            </div>
          ) : null}
          {output != null ? (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Output</div>
              <pre className="overflow-x-auto rounded-md bg-black/30 p-3 text-xs">
                {String(JSON.stringify(replaceImageReferencesForDisplay(output), null, 2) ?? "")}
              </pre>
              <ImageGallery images={outputImages} />
            </div>
          ) : null}
          {error && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
              <pre className="overflow-x-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">{error}</pre>
            </div>
          )}
          {isAdmin && <AdminDebugSection input={input} output={output} error={error} />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
