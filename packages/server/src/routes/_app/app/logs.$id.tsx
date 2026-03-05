import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDebugMode } from "@/hooks/use-debug-mode";
import type { UnifiedTranscriptMessage } from "@agentlogs/shared/claudecode";
import { getModelDisplayName } from "@agentlogs/shared/models";
import { unifiedTranscriptSchema } from "@agentlogs/shared/schemas";
import { createFileRoute, useNavigate, useRouter } from "@tanstack/react-router";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Asterisk,
  Check,
  ChevronDown,
  Clock,
  Coins,
  Copy,
  Database,
  Download,
  ExternalLink,
  FileText,
  Folder,
  GitBranch,
  Globe,
  Hash,
  Link2,
  Loader2,
  Lock,
  Pencil,
  Search,
  Sparkles,
  Square,
  SquareCheck,
  SquareTerminal,
  Terminal,
  Trash2,
  Users,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CodeBlock, DiffViewer, FileViewer, GrepContentViewer, ShellOutput } from "../../../components/diff-viewer";
import {
  ClaudeCodeIcon,
  ClineIcon,
  CodexIcon,
  GitHubIcon,
  MCPIcon,
  OpenCodeIcon,
  PiIcon,
} from "../../../components/icons/source-icons";
import { MarkdownRenderer } from "../../../components/markdown-renderer";

import {
  extractImageReferences,
  type ImageReference,
  replaceImageReferencesForDisplay,
} from "../../../lib/message-utils";
import { deleteTranscript, getTranscript, updateTitle, updateVisibility } from "../../../lib/server-functions";

export const Route = createFileRoute("/_app/app/logs/$id")({
  loader: ({ params }) => getTranscript({ data: params.id }),
  staleTime: 30_000,
  gcTime: 5 * 60_000, // Keep in cache 5min for back navigation
  pendingComponent: TranscriptPendingComponent,
  pendingMinMs: 100, // Only show loading if takes > 100ms (avoids flash)
  component: TranscriptDetailComponent,
  head: ({ loaderData }) => {
    if (!loaderData) return {};

    const title = loaderData.summary || loaderData.preview || "Untitled Thread";
    const description = loaderData.preview || "View this AI agent transcript on AgentLogs";
    const baseUrl = loaderData.baseUrl || "";
    const pageUrl = `${baseUrl}/app/logs/${loaderData.id}`;
    const isPublic = loaderData.visibility === "public";

    // Only include OG image for public transcripts (avoids 404s that get cached by social platforms)
    const ogImageUrl = isPublic ? `${baseUrl}/api/og/${loaderData.id}.png` : undefined;

    return {
      meta: [
        { title: `${title} - AgentLogs` },
        { name: "description", content: description },
        // Open Graph
        { property: "og:title", content: title },
        { property: "og:description", content: description },
        ...(ogImageUrl
          ? [
              { property: "og:image", content: ogImageUrl },
              { property: "og:image:width", content: "1200" },
              { property: "og:image:height", content: "630" },
            ]
          : []),
        { property: "og:url", content: pageUrl },
        { property: "og:type", content: "article" },
        { property: "og:site_name", content: "AgentLogs" },
        // Twitter Card
        {
          name: "twitter:card",
          content: isPublic ? "summary_large_image" : "summary",
        },
        { name: "twitter:title", content: title },
        { name: "twitter:description", content: description },
        ...(ogImageUrl ? [{ name: "twitter:image", content: ogImageUrl }] : []),
      ],
    };
  },
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

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${Math.round(remainingSeconds)}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

function getSourceIcon(source: string, className?: string) {
  switch (source) {
    case "codex":
      return <CodexIcon className={className} />;
    case "claude-code":
      return <ClaudeCodeIcon className={className} />;
    case "opencode":
      return <OpenCodeIcon className={className} />;
    case "pi":
      return <PiIcon className={className} />;
    case "cline":
      return <ClineIcon className={className} />;
    default:
      return <Terminal className={className} />;
  }
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

// Check if a message is "important" and should be shown expanded
// Important messages: user messages, last agent response before user message
function isImportantMessage(
  message: UnifiedTranscriptMessage,
  index: number,
  messages: UnifiedTranscriptMessage[],
): boolean {
  // User messages are always important
  if (message.type === "user") return true;

  // Commands are important (like user prompts)
  if (message.type === "command") return true;

  // Check if this is the last agent response before a user message
  if (message.type === "agent") {
    // Look ahead to find if the next non-thinking, non-tool-call message is a user message
    for (let i = index + 1; i < messages.length; i++) {
      const nextMsg = messages[i];
      if (nextMsg.type === "user" || nextMsg.type === "command") {
        return true; // This agent message is right before a user prompt
      }
      if (nextMsg.type === "agent") {
        return false; // Another agent message comes first
      }
      // Continue past tool-calls and thinking blocks
    }
    // If this is the last agent message in the conversation, it's important
    return true;
  }

  return false;
}

// Segment type for grouping messages
type MessageSegment =
  | { type: "important"; message: UnifiedTranscriptMessage; index: number }
  | {
      type: "collapsed";
      messages: Array<{ message: UnifiedTranscriptMessage; index: number }>;
    };

// Group messages into segments of important messages and collapsed steps
function groupMessagesIntoSegments(messages: UnifiedTranscriptMessage[]): MessageSegment[] {
  const segments: MessageSegment[] = [];
  let currentCollapsedGroup: Array<{
    message: UnifiedTranscriptMessage;
    index: number;
  }> = [];

  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];

    // Skip internal messages
    if (message.type === "user" && isInternalMessage(message.text)) {
      continue;
    }

    if (isImportantMessage(message, i, messages)) {
      // Flush any pending collapsed group
      if (currentCollapsedGroup.length > 0) {
        segments.push({ type: "collapsed", messages: currentCollapsedGroup });
        currentCollapsedGroup = [];
      }
      segments.push({ type: "important", message, index: i });
    } else {
      currentCollapsedGroup.push({ message, index: i });
    }
  }

  // Flush any remaining collapsed group
  if (currentCollapsedGroup.length > 0) {
    segments.push({ type: "collapsed", messages: currentCollapsedGroup });
  }

  return segments;
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
  const [debugMode] = useDebugMode();

  // Parse and validate the unified transcript
  const unifiedTranscript = unifiedTranscriptSchema.parse(data.unifiedTranscript);
  const timeAgo = formatTimeAgo(new Date(data.createdAt));
  const userMessages = getUserMessagesWithIndices(unifiedTranscript.messages);
  const repoInfo = unifiedTranscript.git?.repo ? formatRepoName(unifiedTranscript.git.repo) : null;

  const pageTitle = data.summary || unifiedTranscript.preview || "Untitled Thread";
  const showDebugInfo = data.isAdmin && debugMode;

  // Track permalinked message from URL hash
  const [permalinkedIndex, setPermalinkedIndex] = useState<number | null>(null);

  // Auto-scroll to message and set permalink if hash is present in URL
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      const target = document.querySelector(hash);
      if (target) {
        const rect = target.getBoundingClientRect();
        const scrollTop = window.scrollY + rect.top - 16;
        window.scrollTo({ top: scrollTop, behavior: "instant" });
      }
      // Set permalinked index from hash
      const match = hash.match(/^#msg-(\d+)$/);
      if (match) {
        setPermalinkedIndex(parseInt(match[1], 10) - 1);
      }
    }
  }, []);

  // Clear permalinked state on first user scroll (delay to ignore programmatic scrolls)
  useEffect(() => {
    if (permalinkedIndex === null) return;

    const handleScroll = () => {
      setPermalinkedIndex(null);
    };

    // Delay attaching listener to ignore programmatic scroll from scrollIntoView
    const timeout = setTimeout(() => {
      window.addEventListener("scroll", handleScroll, { once: true });
    }, 500);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("scroll", handleScroll);
    };
  }, [permalinkedIndex]);

  return (
    <div className="flex gap-8">
      {/* Main Content */}
      <div className="min-w-0 flex-1">
        {/* Header with lines changed */}
        <header className="mb-1">
          <EditableTitle transcriptId={data.id} initialTitle={pageTitle} canEdit={data.isOwner || data.isAdmin}>
            {(data.linesAdded > 0 || data.linesRemoved > 0 || data.linesModified > 0) && (
              <span className="flex shrink-0 items-center gap-1 text-sm">
                {data.linesAdded > 0 && <span className="text-green-500">+{data.linesAdded}</span>}
                {data.linesModified > 0 && <span className="text-yellow-500">~{data.linesModified}</span>}
                {data.linesRemoved > 0 && <span className="text-red-400">-{data.linesRemoved}</span>}
              </span>
            )}
          </EditableTitle>
        </header>

        {/* Log Metadata */}
        <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground md:mb-8">
          {/* Author */}
          <a
            href={`https://github.com/${data.userUsername}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 hover:text-foreground"
          >
            <img src={data.userImage || undefined} alt={data.userUsername || "User"} className="h-4 w-4 rounded-full" />
            <span>@{data.userUsername || "unknown"}</span>
          </a>
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
            {unifiedTranscript.model && (
              <TooltipContent side="bottom" className="whitespace-pre-line">
                {unifiedTranscript.model}
                {unifiedTranscript.clientVersion && `\nClaude Code ${unifiedTranscript.clientVersion}`}
              </TooltipContent>
            )}
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
          {/* Delete button - only for owner or admin */}
          {(data.isOwner || data.isAdmin) && <DeleteTranscriptButton transcriptId={data.id} />}
        </div>

        {/* Debug Info (admin only) */}
        {showDebugInfo && (
          <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-dashed border-yellow-500/30 bg-yellow-950/10 px-3 py-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Hash className="h-4 w-4" />
              <span className="font-mono text-xs">{data.transcriptId}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Coins className="h-4 w-4" />
              <span>{data.costUsd != null ? `$${data.costUsd.toFixed(4)}` : "n/a"}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ArrowDownToLine className="h-4 w-4" />
              <span>{data.inputTokens?.toLocaleString() ?? 0} in</span>
            </div>
            <div className="flex items-center gap-1.5">
              <ArrowUpFromLine className="h-4 w-4" />
              <span>{data.outputTokens?.toLocaleString() ?? 0} out</span>
            </div>
            {(data.cachedInputTokens ?? 0) > 0 && (
              <div className="flex items-center gap-1.5">
                <Database className="h-4 w-4" />
                <span>{data.cachedInputTokens?.toLocaleString()} cached</span>
              </div>
            )}
            <div className="ml-auto flex items-center gap-2">
              <a
                href={`/api/admin/transcript-unified/${data.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 rounded bg-yellow-500/20 px-2 py-1 text-xs font-medium text-yellow-500 transition-colors hover:bg-yellow-500/30"
              >
                <Download className="h-3 w-3" />
                Unified
              </a>
            </div>
          </div>
        )}

        {/* OG Image Preview (debug mode only, public transcripts only) */}
        {showDebugInfo && data.visibility === "public" && (
          <div className="mb-4 overflow-hidden rounded-lg border border-dashed border-yellow-500/30">
            <div className="bg-yellow-950/10 px-3 py-1.5 text-xs font-medium text-yellow-500">OG Image Preview</div>
            <img
              src={`/api/og/${data.id}.png?title=${encodeURIComponent(pageTitle)}`}
              alt="OG preview"
              className="w-full"
            />
          </div>
        )}

        {/* Messages */}
        <div className="space-y-4 [--color-foreground:color-mix(in_oklab,var(--foreground)_90%,_transparent)] md:space-y-8">
          {groupMessagesIntoSegments(unifiedTranscript.messages).map((segment, i) =>
            segment.type === "important" ? (
              <MessageBlock
                key={`msg-${segment.index}`}
                message={segment.message}
                index={segment.index}
                showDebugInfo={showDebugInfo}
                isPermalinked={permalinkedIndex === segment.index}
                onPermalink={setPermalinkedIndex}
              />
            ) : (
              <CollapsedSteps key={`collapsed-${i}`} messages={segment.messages} showDebugInfo={showDebugInfo} />
            ),
          )}
        </div>
      </div>

      {/* Sidebar - vertically centered TOC with independent scroll */}
      <aside className="sticky top-0 hidden max-h-screen w-1/4 shrink-0 self-start lg:flex lg:items-start">
        <div className="max-h-screen space-y-6 overflow-y-auto p-2">
          {/* Share URL */}
          <ShareUrlInput transcriptId={data.id} permalinkedIndex={permalinkedIndex} />
          {/* User Prompts Navigation */}
          {userMessages.length > 0 && (
            <PromptsList
              userMessages={userMessages}
              permalinkedIndex={permalinkedIndex}
              onPermalink={setPermalinkedIndex}
            />
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
  permalinkedIndex,
  onPermalink,
}: {
  userMessages: Array<{ index: number; text: string }>;
  permalinkedIndex: number | null;
  onPermalink: (index: number | null) => void;
}) {
  const [scrollActiveIndex, setScrollActiveIndex] = useState<number | null>(userMessages[0]?.index ?? null);
  // Use permalinked index if set, otherwise use scroll-tracked index
  const activeIndex = permalinkedIndex ?? scrollActiveIndex;

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

      setScrollActiveIndex(closestIndex);
    };

    // Initial calculation
    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, [userMessages]);

  const scrollToMessage = (e: React.MouseEvent, index: number) => {
    e.preventDefault();
    const messageId = `msg-${index + 1}`;
    const target = document.getElementById(messageId);
    if (target) {
      onPermalink(index);
      target.scrollIntoView({ behavior: "instant", block: "start" });
      window.history.pushState(null, "", `#${messageId}`);
    }
  };

  const padLength = String(userMessages.length).length;

  return (
    <section>
      <div className="mb-2 text-xs font-medium text-muted-foreground">Prompts</div>
      <div className="space-y-0.5">
        {userMessages.map((msg, i) => (
          <a
            key={msg.index}
            href={`#msg-${msg.index + 1}`}
            onClick={(e) => scrollToMessage(e, msg.index)}
            className={`block w-full truncate py-1 text-left text-sm transition-colors hover:text-foreground ${
              activeIndex === msg.index ? "text-foreground" : "text-muted-foreground"
            }`}
          >
            <span className="mr-2 text-muted-foreground/60 tabular-nums">{String(i + 1).padStart(padLength, "0")}</span>
            {msg.text}
          </a>
        ))}
      </div>
    </section>
  );
}

function ShareUrlInput({ transcriptId, permalinkedIndex }: { transcriptId: string; permalinkedIndex: number | null }) {
  const [copied, setCopied] = useState(false);

  const shareUrl =
    permalinkedIndex !== null
      ? `https://agentlogs.ai/s/${transcriptId}#msg-${permalinkedIndex + 1}`
      : `https://agentlogs.ai/s/${transcriptId}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(shareUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative">
      <Input readOnly value={shareUrl} className="h-7 truncate px-2 py-0 pr-8 text-xs text-muted-foreground" />
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        className="absolute top-1/2 right-0.5 h-5 -translate-y-1/2 px-1 text-muted-foreground"
      >
        {copied ? <Check className="h-2 w-2" /> : <Copy className="h-2 w-2" />}
      </Button>
    </div>
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

interface DeleteTranscriptButtonProps {
  transcriptId: string;
}

function DeleteTranscriptButton({ transcriptId }: DeleteTranscriptButtonProps) {
  const navigate = useNavigate();
  const [isDeleting, setIsDeleting] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await deleteTranscript({ data: { transcriptId } });
      // Redirect to home after successful deletion
      navigate({ to: "/app" });
    } catch (err) {
      console.error("Failed to delete transcript:", err);
      setIsDeleting(false);
      setIsOpen(false);
    }
  };

  return (
    <AlertDialog open={isOpen} onOpenChange={setIsOpen}>
      <AlertDialogTrigger
        className="flex cursor-pointer items-center gap-1.5 text-muted-foreground transition-colors hover:text-destructive"
        render={<button type="button" />}
      >
        <Trash2 className="h-4 w-4" />
        <span>Delete</span>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete transcript?</AlertDialogTitle>
          <AlertDialogDescription>
            This action cannot be undone. The transcript and its metadata will be permanently deleted.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={handleDelete} disabled={isDeleting}>
            {isDeleting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
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

interface EditableTitleProps {
  transcriptId: string;
  initialTitle: string;
  canEdit: boolean;
  children?: React.ReactNode;
}

function EditableTitle({ transcriptId, initialTitle, canEdit, children }: EditableTitleProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [editValue, setEditValue] = useState(initialTitle);
  const [isUpdating, setIsUpdating] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleStartEdit = () => {
    if (!canEdit) return;
    setEditValue(title);
    setIsEditing(true);
  };

  const handleCancel = () => {
    setIsEditing(false);
    setEditValue(title);
  };

  const handleSave = async () => {
    const newTitle = editValue.trim();
    if (newTitle === title) {
      setIsEditing(false);
      return;
    }

    setIsUpdating(true);
    const minDisplayPromise = new Promise((resolve) => setTimeout(resolve, 200));

    try {
      await Promise.all([updateTitle({ data: { transcriptId, title: newTitle } }), minDisplayPromise]);
      setTitle(newTitle || "Untitled Thread");
      setIsEditing(false);
    } catch (err) {
      console.error("Failed to update title:", err);
      // Keep editing mode open on error
      await minDisplayPromise;
    } finally {
      setIsUpdating(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      handleCancel();
    }
  };

  if (isEditing) {
    return (
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={isUpdating ? undefined : handleCancel}
          disabled={isUpdating}
          className="min-w-0 flex-1 truncate bg-transparent font-serif text-3xl font-semibold tracking-wide outline-none"
          placeholder="Untitled Thread"
        />
        {isUpdating && <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />}
      </div>
    );
  }

  return (
    <div className="group/title flex min-w-0 items-baseline gap-3">
      <div className="relative min-w-0">
        <h1 className="min-w-0 truncate font-serif text-3xl font-semibold tracking-wide">
          {title || "Untitled Thread"}
        </h1>
        {canEdit && (
          <button
            type="button"
            onClick={handleStartEdit}
            className="absolute top-1 -right-6 rounded bg-background p-1 opacity-0 transition-opacity group-hover/title:opacity-100"
            title="Edit title"
          >
            <Pencil className="h-3 w-3 text-muted-foreground hover:text-foreground" />
          </button>
        )}
      </div>
      {children}
    </div>
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

// Parse MCP tool name: mcp__server__function -> { server, fn }
function parseMCPToolName(toolName: string | null): { server: string; fn: string } | null {
  if (!toolName) return null;
  const match = toolName.match(/^mcp__([^_]+)__(.+)$/);
  if (!match) return null;
  return { server: match[1], fn: match[2] };
}

// Build CLI-style args string for Grep tool (without the `rg` prefix)
function buildGrepCliArgs(input: Record<string, unknown>): string {
  const parts: string[] = [];

  // Flags
  if (input["-i"]) parts.push("-i");
  if (input.multiline) parts.push("-U");

  // Context
  if (input["-A"]) parts.push(`-A ${input["-A"]}`);
  if (input["-B"]) parts.push(`-B ${input["-B"]}`);
  if (input["-C"]) parts.push(`-C ${input["-C"]}`);

  // Output mode flags
  if (input.output_mode === "files_with_matches") parts.push("-l");
  else if (input.output_mode === "count") parts.push("-c");

  // Filters
  if (input.glob) parts.push(`--glob "${input.glob}"`);
  if (input.type) parts.push(`--type ${input.type}`);

  // Pattern (quoted)
  if (input.pattern) parts.push(`"${input.pattern}"`);

  // Path (strip ./ prefix)
  if (input.path) parts.push(String(input.path).replace(/^\.\//, ""));

  return parts.join(" ");
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
      return Asterisk;
    case "Grep":
    case "WebSearch":
      return Search;
    case "WebFetch":
      return Globe;
    case "Task":
    case "Explore":
      return Sparkles;
    case "Skill":
      return Terminal;
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
      return inputObj ? buildGrepCliArgs(inputObj) : "";
    case "Bash":
      return inputObj?.command ? String(inputObj.command) : "";
    case "Task":
      return inputObj?.description ? String(inputObj.description) : inputObj?.prompt ? String(inputObj.prompt) : "";
    case "WebFetch":
      return inputObj?.url ? String(inputObj.url) : "";
    case "WebSearch":
      return inputObj?.query ? String(inputObj.query) : "";
    case "Skill":
      return inputObj?.name ? String(inputObj.name) : inputObj?.skill ? String(inputObj.skill) : "";
    case "Explore":
      return inputObj?.description ? String(inputObj.description) : inputObj?.prompt ? String(inputObj.prompt) : "";
    default:
      return "";
  }
}

interface MessageBlockProps {
  message: UnifiedTranscriptMessage;
  index: number;
  showDebugInfo?: boolean;
  isPermalinked?: boolean;
  onPermalink?: (index: number) => void;
}

function MessageBlock({ message, index, showDebugInfo, isPermalinked, onPermalink }: MessageBlockProps) {
  const messageId = `msg-${index + 1}`;

  // User message - dark pill with avatar
  if (message.type === "user") {
    // Skip internal system messages
    if (isInternalMessage(message.text)) {
      return null;
    }

    const userImages = message.images ?? [];

    const handlePermalink = (e: React.MouseEvent) => {
      e.preventDefault();
      onPermalink?.(index);
      window.history.pushState(null, "", `#${messageId}`);
    };

    return (
      <div id={messageId} className="group/permalink scroll-mt-4">
        <div
          className={`relative rounded-lg bg-secondary/80 px-5 py-5 ${isPermalinked ? "ring-1 ring-foreground/20" : ""}`}
        >
          <Button
            variant="ghost"
            size="icon-xs"
            asChild
            className="absolute top-[calc(var(--radius-lg)-var(--radius-md))] right-[calc(var(--radius-lg)-var(--radius-md))] opacity-0 transition-opacity group-hover/permalink:opacity-100 hover:!bg-foreground/10"
          >
            <a href={`#${messageId}`} onClick={handlePermalink} title="Permalink">
              <Link2 className="h-3.5 w-3.5" />
            </a>
          </Button>
          <TruncatedUserMessage text={message.text} />
          <ImageGallery images={userImages} />
        </div>
      </div>
    );
  }

  // Thinking block - collapsible
  if (message.type === "thinking") {
    return <ThinkingBlock messageId={messageId} text={message.text} />;
  }

  // Tool call - collapsible with icon, images displayed underneath
  if (message.type === "tool-call") {
    // Use direct images array (pi format) or extract from output (claudecode format)
    const toolImages = message.images ?? extractImageReferences(message.output);
    return (
      <div className={toolImages.length > 0 ? "flex flex-col gap-3" : undefined}>
        <ToolCallBlock
          messageId={messageId}
          toolName={message.toolName}
          input={message.input}
          output={message.output}
          images={message.images}
          error={message.error}
          isError={message.isError}
          showDebugInfo={showDebugInfo}
        />
        {toolImages.length > 0 && <ImageGallery images={toolImages} />}
      </div>
    );
  }

  // Agent response - rendered text
  if (message.type === "agent") {
    return (
      <div id={messageId} className="scroll-mt-4">
        <MarkdownRenderer className="prose-invert prose-sm prose max-w-none text-sm">{message.text}</MarkdownRenderer>
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

// Collapsed steps component - groups unimportant messages into a collapsible section
function CollapsedSteps({
  messages,
  showDebugInfo,
}: {
  messages: Array<{ message: UnifiedTranscriptMessage; index: number }>;
  showDebugInfo?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);

  if (messages.length === 0) return null;

  // Calculate total diff stats from Write/Edit tools in this collapsed section
  let totalAdded = 0;
  let totalRemoved = 0;
  let totalModified = 0;

  for (const { message } of messages) {
    if (message.type === "tool-call") {
      const inputObj = message.input as Record<string, unknown> | undefined;

      if (message.toolName === "Edit" && inputObj?.diff) {
        const stats = parseDiffStats(String(inputObj.diff));
        totalAdded += stats.added - stats.modified;
        totalRemoved += stats.removed - stats.modified;
        totalModified += stats.modified;
      } else if (message.toolName === "Write" && inputObj?.content) {
        const lineCount = String(inputObj.content).split("\n").length;
        totalAdded += lineCount;
      }
    }
  }

  const hasChanges = totalAdded > 0 || totalRemoved > 0 || totalModified > 0;

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="group/steps">
      <div className="flex items-center gap-2">
        <CollapsibleTrigger className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:border-muted-foreground/30 hover:text-foreground">
          <ChevronDown className="h-4 w-4 transition-transform group-data-[open]/steps:rotate-180" />
          <span>{isOpen ? `Hide ${messages.length} steps` : `${messages.length} steps hidden`}</span>
        </CollapsibleTrigger>
        {hasChanges && (
          <span className="flex items-center gap-1 text-sm">
            {totalAdded > 0 && <span className="text-green-500">+{totalAdded}</span>}
            {totalModified > 0 && <span className="text-yellow-500">~{totalModified}</span>}
            {totalRemoved > 0 && <span className="text-red-400">-{totalRemoved}</span>}
          </span>
        )}
      </div>
      <CollapsibleContent>
        <div className="mt-3 ml-2 space-y-3 border-l border-border pl-4">
          {messages.map(({ message, index }) => (
            <MessageBlock key={index} message={message} index={index} showDebugInfo={showDebugInfo} />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function TruncatedUserMessage({ text }: { text: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  // Rough heuristic: long content threshold
  const lineCount = text.split("\n").length;
  const isLong = text.length > 1600 || lineCount > 20;

  if (!isLong) {
    return <p className="text-sm wrap-break-word whitespace-pre-wrap">{text}</p>;
  }

  return (
    <div>
      <p className={`text-sm wrap-break-word whitespace-pre-wrap ${!isExpanded ? "line-clamp-[20]" : ""}`}>
        {isExpanded ? text : text.trimEnd()}
      </p>
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="mt-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {isExpanded ? "Show less" : "Show more"}
      </button>
    </div>
  );
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
          <MarkdownRenderer className="prose-invert prose-sm prose max-w-none">{text}</MarkdownRenderer>
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
  images?: ImageReference[];
  error?: string;
  isError?: boolean | string;
  showDebugInfo?: boolean;
}

// Parse diff to count additions, deletions, and modifications
function parseDiffStats(diff: string): {
  added: number;
  removed: number;
  modified: number;
} {
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

// Debug section - shows raw JSON data (only shown when admin has debug mode enabled)
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

function ToolCallBlock({
  messageId,
  toolName,
  input,
  output,
  images,
  error,
  isError,
  showDebugInfo,
}: ToolCallBlockProps) {
  const Icon = getToolIcon(toolName);
  const description = getToolDescription(toolName, input);
  const displayName = getToolDisplayName(toolName);

  // Extract images from input/output (for claudecode format) or use direct images prop (for pi format)
  const inputImages = extractImageReferences(input);
  const outputImages = images ?? extractImageReferences(output);

  const inputObj = input as Record<string, unknown> | undefined;
  const outputObj = output as Record<string, unknown> | undefined;
  const fileObj = outputObj?.file as Record<string, unknown> | undefined;
  const isEditWithDiff = toolName === "Edit" && !!inputObj?.file_path && !!inputObj?.diff;
  const isWriteWithContent = toolName === "Write" && !!inputObj?.file_path && !!inputObj?.content;
  const isReadWithContent = toolName === "Read" && !!inputObj?.file_path && !!fileObj?.content;
  const isBashWithCommand = toolName === "Bash" && !!inputObj?.command;
  const isGrepWithContent =
    toolName === "Grep" && outputObj?.mode === "content" && typeof outputObj?.content === "string";
  const grepFilenames = outputObj?.filenames;
  const isGrepWithFilenames = toolName === "Grep" && Array.isArray(grepFilenames) && grepFilenames.length > 0;
  const isGlobWithFilenames = toolName === "Glob" && Array.isArray(outputObj?.filenames);
  const isWebSearchWithResults = toolName === "WebSearch" && Array.isArray(outputObj?.results);

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
            {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // For Read tool with file content
  if (isReadWithContent) {
    const fileContent = String(fileObj!.content);
    const numLines = fileObj?.numLines ? Number(fileObj.numLines) : fileContent.split("\n").length;
    const startLine = fileObj?.startLine ? Number(fileObj.startLine) : 1;
    const totalLines = fileObj?.totalLines ? Number(fileObj.totalLines) : numLines;
    const endLine = startLine + numLines - 1;
    const isPartialRead = startLine > 1 || numLines !== totalLines;

    return (
      <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
        <CollapsibleTrigger className={triggerClassName}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{displayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {filePath}
            {isPartialRead && (
              <span className="text-muted-foreground/50">
                {" "}
                ({startLine}:{endLine})
              </span>
            )}
          </span>
          <span className="shrink-0 text-sm text-muted-foreground">{numLines} lines</span>
          {(error || isError) && (
            <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div>
            <FileViewer filePath={filePath} content={fileContent} startLine={startLine} hideHeader />
            {(error || isError) && (
              <div className="m-3 rounded-lg bg-destructive/10 p-3">
                <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
                <pre className="text-xs text-destructive">{error || "Operation failed"}</pre>
              </div>
            )}
            {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // For Grep results with content (content mode)
  if (isGrepWithContent) {
    const grepContent = String(outputObj!.content);
    const numMatches = outputObj?.numMatches ? Number(outputObj.numMatches) : grepContent.split("\n").length;
    const inputPath = inputObj?.path ? String(inputObj.path).replace(/^\.\//, "") : undefined;

    return (
      <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
        <CollapsibleTrigger className={triggerClassName}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{displayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{description}</span>
          <span className="shrink-0 text-sm text-muted-foreground">{numMatches} matches</span>
          {(error || isError) && (
            <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="p-3">
            <GrepContentViewer content={grepContent} inputPath={inputPath} />
            {error && (
              <div className="mt-3">
                <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
                <pre className="overflow-x-auto rounded-md bg-destructive/10 p-3 font-mono text-xs whitespace-pre-wrap text-destructive">
                  {error}
                </pre>
              </div>
            )}
            {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // For Grep results with filenames (files_with_matches mode)
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
            {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // For Glob results with filenames
  if (isGlobWithFilenames) {
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
            {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
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
            {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // For TodoWrite tool - render as a nice todo list
  if (toolName === "TodoWrite") {
    type TodoItem = {
      content: string;
      status: "pending" | "in_progress" | "completed";
      activeForm?: string;
    };
    const todos: TodoItem[] = (outputObj?.newTodos ?? inputObj?.todos ?? outputObj?.oldTodos ?? []) as TodoItem[];
    const completedCount = todos.filter((t) => t.status === "completed").length;

    return (
      <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
        <CollapsibleTrigger className={triggerClassName}>
          <SquareCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">Todo</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {completedCount}/{todos.length} completed
          </span>
          {(error || isError) && (
            <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <ul className="space-y-1 p-3 font-sans">
            {todos.map((todo, i) => (
              <li key={i} className="flex items-start gap-2">
                {todo.status === "completed" ? (
                  <SquareCheck className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <Square className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span
                  className={
                    todo.status === "completed"
                      ? "text-sm text-muted-foreground line-through"
                      : todo.status === "in_progress"
                        ? "text-sm text-foreground"
                        : "text-sm text-muted-foreground"
                  }
                >
                  {todo.content}
                  {todo.status === "in_progress" && (
                    <Badge variant="secondary" className="ml-1.5 h-4 align-middle text-[10px]">
                      in progress
                    </Badge>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {(error || isError) && (
            <div className="m-3 rounded-lg bg-destructive/10 p-3">
              <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
              <pre className="text-xs text-destructive">{error || "Operation failed"}</pre>
            </div>
          )}
          {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // WebSearch tool rendering
  if (isWebSearchWithResults) {
    const results = outputObj!.results as unknown[];

    // Extract markdown text (string items in results array)
    const markdownTexts: string[] = [];
    // Extract links (from objects with content array)
    const links: Array<{ title: string; url: string }> = [];

    for (const item of results) {
      if (typeof item === "string") {
        markdownTexts.push(item);
      } else if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        if (Array.isArray(obj.content)) {
          for (const link of obj.content) {
            if (
              typeof link === "object" &&
              link !== null &&
              typeof (link as Record<string, unknown>).title === "string" &&
              typeof (link as Record<string, unknown>).url === "string"
            ) {
              links.push({
                title: (link as Record<string, string>).title,
                url: (link as Record<string, string>).url,
              });
            }
          }
        }
      }
    }

    const resultCount = links.length;

    return (
      <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
        <CollapsibleTrigger className={triggerClassName}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">WebSearch</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{description}</span>
          {resultCount > 0 && !error && !isError && (
            <span className="shrink-0 text-sm text-muted-foreground">{resultCount} results</span>
          )}
          {(error || isError) && (
            <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 p-3">
            {/* Markdown summary first */}
            {markdownTexts.length > 0 && (
              <MarkdownRenderer className="prose-sm prose-invert prose max-w-none">
                {markdownTexts.join("\n\n")}
              </MarkdownRenderer>
            )}
            {/* Links list */}
            {links.length > 0 && (
              <ol className="space-y-1">
                {links.map((link, i) => (
                  <li key={i} className="flex items-baseline gap-2">
                    <span className="shrink-0 text-sm text-muted-foreground/50 tabular-nums">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground"
                    >
                      <span className="truncate">{link.title}</span>
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                  </li>
                ))}
              </ol>
            )}
            {/* Error display */}
            {error && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
                <pre className="overflow-x-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">{error}</pre>
              </div>
            )}
            {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Task tool rendering
  if (toolName === "Task") {
    type TaskContentItem = { type?: string; text?: string };
    const taskOutput = outputObj as
      | {
          status?: string;
          totalDurationMs?: number;
          totalToolUseCount?: number;
          content?: TaskContentItem[];
        }
      | undefined;
    const subagentType = inputObj?.subagent_type ? String(inputObj.subagent_type) : null;
    const taskDescription = inputObj?.description ? String(inputObj.description) : null;
    const taskPrompt = inputObj?.prompt ? String(inputObj.prompt) : null;
    const durationMs = taskOutput?.totalDurationMs;

    // Extract text content from output
    const textContents: string[] = [];
    if (Array.isArray(taskOutput?.content)) {
      for (const item of taskOutput.content) {
        if (typeof item === "object" && item !== null && item.type === "text" && typeof item.text === "string") {
          textContents.push(item.text);
        }
      }
    }

    return (
      <div className="flex flex-col gap-3">
        <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
          <CollapsibleTrigger className={triggerClassName}>
            <ClaudeCodeIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">{subagentType ?? "Task"}</span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
              {taskDescription ?? (taskPrompt ? taskPrompt.slice(0, 80) : "")}
            </span>
            {durationMs != null && !error && !isError && (
              <span className="shrink-0 text-sm text-muted-foreground">{formatDuration(durationMs)}</span>
            )}
            {(error || isError) && (
              <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
            )}
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 p-3">
              {/* Prompt rendered as markdown */}
              {taskPrompt && (
                <div className="rounded-md bg-secondary/60 p-3">
                  <MarkdownRenderer className="prose-sm prose-invert prose max-w-none">{taskPrompt}</MarkdownRenderer>
                </div>
              )}
              {/* Output text rendered as markdown */}
              {textContents.length > 0 && (
                <MarkdownRenderer className="prose-sm prose-invert prose max-w-none">
                  {textContents.join("\n\n")}
                </MarkdownRenderer>
              )}
              {/* Error display */}
              {error && (
                <div>
                  <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
                  <pre className="overflow-x-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                    {error}
                  </pre>
                </div>
              )}
              {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    );
  }

  // MCP tool rendering
  const mcpInfo = parseMCPToolName(toolName);
  if (mcpInfo) {
    // Extract text content and files from output
    const outputArray = Array.isArray(output) ? output : [];
    const textContents: string[] = [];
    const fileContents: Array<{ path: string; label: string }> = [];

    for (const item of outputArray) {
      if (typeof item === "object" && item !== null) {
        const obj = item as Record<string, unknown>;
        if (obj.type === "text" && typeof obj.text === "string") {
          textContents.push(obj.text);
        }
      }
    }

    // Parse file references from text content (e.g., "[Screenshot of viewport](/path/to/file.png)")
    for (const text of textContents) {
      const fileMatches = text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
      for (const match of fileMatches) {
        if (match[2].startsWith("/") && !match[2].startsWith("/url")) {
          fileContents.push({ label: match[1], path: match[2] });
        }
      }
    }

    // Get first image for collapsed preview
    const previewImage = outputImages.length > 0 ? outputImages[0] : null;

    return (
      <div className="flex flex-col gap-3">
        <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
          <CollapsibleTrigger className={triggerClassName}>
            <MCPIcon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="text-sm font-medium">
              {mcpInfo.server.charAt(0).toUpperCase() + mcpInfo.server.slice(1)}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{mcpInfo.fn}</span>
            {(error || isError) && (
              <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
            )}
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="space-y-3 p-3">
              {/* Input as JSON syntax highlighted */}
              {input != null && (
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Input</div>
                  <CodeBlock
                    content={JSON.stringify(replaceImageReferencesForDisplay(input), null, 2)}
                    language="json"
                  />
                </div>
              )}
              {/* Output text rendered as markdown */}
              {textContents.length > 0 && (
                <div>
                  <div className="mb-1.5 text-xs font-medium text-muted-foreground">Output</div>
                  <MarkdownRenderer className="prose-sm prose-invert prose max-w-none">
                    {textContents.join("\n\n")}
                  </MarkdownRenderer>
                </div>
              )}
              {/* Error display */}
              {error && (
                <div>
                  <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
                  <pre className="overflow-x-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">
                    {error}
                  </pre>
                </div>
              )}
              {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
            </div>
          </CollapsibleContent>
        </Collapsible>
        {previewImage && (
          <a href={`/api/blobs/${previewImage.sha256}`} target="_blank" rel="noopener noreferrer">
            <img
              src={`/api/blobs/${previewImage.sha256}`}
              alt="Preview"
              className="max-h-96 rounded-lg border border-border"
            />
          </a>
        )}
      </div>
    );
  }

  // WebFetch tool - render content as markdown
  if (toolName === "WebFetch") {
    const content = outputObj?.content ? String(outputObj.content) : null;
    const url = inputObj?.url ? String(inputObj.url) : "";

    return (
      <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
        <CollapsibleTrigger className={triggerClassName}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{displayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{url}</span>
          {(error || isError) && (
            <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 p-3">
            {content && (
              <MarkdownRenderer className="prose-sm prose-invert prose max-w-none">{content}</MarkdownRenderer>
            )}
            {(error || isError) && (
              <div className="rounded-lg bg-destructive/10 p-3">
                <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
                <pre className="text-xs text-destructive">{error || "Operation failed"}</pre>
              </div>
            )}
            {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Skill tool - render content as markdown with skill name
  if (toolName === "Skill") {
    const content = outputObj?.content ? String(outputObj.content) : null;
    const skillName = inputObj?.name ? String(inputObj.name) : inputObj?.skill ? String(inputObj.skill) : "";

    return (
      <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
        <CollapsibleTrigger className={triggerClassName}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{displayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{skillName}</span>
          {(error || isError) && (
            <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 p-3">
            {content && (
              <MarkdownRenderer className="prose-sm prose-invert prose max-w-none">{content}</MarkdownRenderer>
            )}
            {(error || isError) && (
              <div className="rounded-lg bg-destructive/10 p-3">
                <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
                <pre className="text-xs text-destructive">{error || "Operation failed"}</pre>
              </div>
            )}
            {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
          </div>
        </CollapsibleContent>
      </Collapsible>
    );
  }

  // Explore tool - render content as markdown
  if (toolName === "Explore") {
    const content = outputObj?.content ? String(outputObj.content) : null;
    const exploreDescription = inputObj?.description ? String(inputObj.description) : "";

    return (
      <Collapsible id={messageId} defaultOpen={false} className={collapsibleClassName}>
        <CollapsibleTrigger className={triggerClassName}>
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium">{displayName}</span>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{exploreDescription}</span>
          {(error || isError) && (
            <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
          )}
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-data-[open]:rotate-180" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-3 p-3">
            {content && (
              <MarkdownRenderer className="prose-sm prose-invert prose max-w-none">{content}</MarkdownRenderer>
            )}
            {(error || isError) && (
              <div className="rounded-lg bg-destructive/10 p-3">
                <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
                <pre className="text-xs text-destructive">{error || "Operation failed"}</pre>
              </div>
            )}
            {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
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
          {input != null && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Input</div>
              <CodeBlock content={JSON.stringify(replaceImageReferencesForDisplay(input), null, 2)} language="json" />
              <ImageGallery images={inputImages} />
            </div>
          )}
          {output != null && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-muted-foreground">Output</div>
              <CodeBlock content={JSON.stringify(replaceImageReferencesForDisplay(output), null, 2)} language="json" />
            </div>
          )}
          {error && (
            <div>
              <div className="mb-1.5 text-xs font-medium text-destructive">Error</div>
              <pre className="overflow-x-auto rounded-md bg-destructive/10 p-3 text-xs text-destructive">{error}</pre>
            </div>
          )}
          {showDebugInfo && <AdminDebugSection input={input} output={output} error={error} />}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
