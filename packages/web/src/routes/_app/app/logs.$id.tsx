import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { UnifiedTranscriptMessage } from "@agentlogs/shared/claudecode";
import { unifiedTranscriptSchema } from "@agentlogs/shared/schemas";
import {
  Calendar,
  ChevronDown,
  ChevronRight,
  CircleDollarSign,
  FileText,
  Folder,
  GitBranch,
  Globe,
  MessageSquare,
  Pencil,
  Search,
  Sparkles,
  SquareTerminal,
  Tag,
  Terminal,
  Zap,
} from "lucide-react";
import { ClaudeCodeIcon, CodexIcon, OpenCodeIcon } from "../../../components/icons/source-icons";
import { useEffect, useState } from "react";
import { extractImageReferences, replaceImageReferencesForDisplay, type ImageReference } from "../../../lib/message-utils";
import { getTranscript } from "../../../lib/server-functions";

export const Route = createFileRoute("/_app/app/logs/$id")({
  loader: ({ params }) => getTranscript({ data: params.id }),
  component: TranscriptDetailComponent,
});

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

function getSourceLabel(source: string): string {
  switch (source) {
    case "codex":
      return "Codex";
    case "claude-code":
      return "Claude Code";
    case "opencode":
      return "OpenCode";
    default:
      return "Unknown";
  }
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
  if (model.includes("opus")) return "Opus 4.5";
  if (model.includes("sonnet")) return "Sonnet 4";
  if (model.includes("haiku")) return "Haiku 3.5";
  return model;
}

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// Count user prompts in messages
function countUserPrompts(messages: UnifiedTranscriptMessage[]): number {
  return messages.filter((m) => m.type === "user").length;
}

// Get unique tools used in transcript
function getUsedTools(messages: UnifiedTranscriptMessage[]): string[] {
  const tools = new Set<string>();
  for (const msg of messages) {
    if (msg.type === "tool-call" && msg.toolName) {
      tools.add(msg.toolName);
    }
  }
  return Array.from(tools);
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
  const userPrompts = countUserPrompts(unifiedTranscript.messages);
  const usedTools = getUsedTools(unifiedTranscript.messages);
  const userMessages = getUserMessagesWithIndices(unifiedTranscript.messages);

  // Calculate token usage percentage (approximate context limit)
  const contextLimit = 200000; // Claude's context limit
  const tokenPercentage = Math.round((unifiedTranscript.tokenUsage.totalTokens / contextLimit) * 100);

  // Auto-scroll to message if hash is present in URL
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      setTimeout(() => {
        const target = document.querySelector(hash);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, []);

  return (
    <div className="flex gap-8">
      {/* Fixed Navigation Indicator */}
      <MessageNavigator userMessages={userMessages} />

      {/* Main Content */}
      <div className="min-w-0 flex-1">
        {/* Header */}
        <header className="mb-8">
          <h1 className="mb-3 text-2xl font-semibold tracking-tight">
            {unifiedTranscript.preview || "Untitled Thread"}
          </h1>
          <div className="flex items-center gap-2">
            <Avatar className="h-6 w-6">
              <AvatarImage src={data.userImage || undefined} alt={data.userName || "User"} />
              <AvatarFallback className="text-xs">{getInitials(data.userName)}</AvatarFallback>
            </Avatar>
            <span className="font-medium">{data.userName || "Unknown"}</span>
            {data.userName && (
              <span className="text-muted-foreground">@{data.userName.toLowerCase().replace(/\s/g, "")}</span>
            )}
          </div>
        </header>

        {/* Messages */}
        <div className="space-y-4">
          {unifiedTranscript.messages.map((message, i) => (
            <MessageBlock key={i} message={message} index={i} userImage={data.userImage} userName={data.userName} />
          ))}
        </div>
      </div>

      {/* Sidebar */}
      <aside className="sticky top-8 hidden h-fit w-72 shrink-0 lg:block">
        <div className="space-y-6">
          {/* Thread Metadata */}
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Thread</h2>
            <div className="space-y-2.5 text-sm">
              <SidebarItem icon={<Calendar className="h-4 w-4" />} label={timeAgo} />
              {unifiedTranscript.git?.repo && (
                <SidebarItem
                  icon={<Folder className="h-4 w-4" />}
                  label={unifiedTranscript.git.repo}
                  link={`/repos/${data.repoId}`}
                />
              )}
              {unifiedTranscript.git?.branch && (
                <SidebarItem icon={<GitBranch className="h-4 w-4" />} label={unifiedTranscript.git.branch} />
              )}
              <SidebarItem
                icon={<Sparkles className="h-4 w-4" />}
                label={getModelDisplayName(unifiedTranscript.model)}
              />
              <SidebarItem
                icon={<CircleDollarSign className="h-4 w-4" />}
                label={`$${unifiedTranscript.costUsd.toFixed(2)}`}
              />
              <SidebarItem icon={getSourceIcon(data.source, "h-4 w-4")} label={getSourceLabel(data.source)} />
              <SidebarItem icon={<MessageSquare className="h-4 w-4" />} label={`${userPrompts} prompts`} />
              <SidebarItem
                icon={<Zap className="h-4 w-4" />}
                label={`${tokenPercentage}% of ${Math.round(contextLimit / 1000)}k`}
              />
            </div>
          </section>

          {/* Tools Used */}
          {usedTools.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium text-muted-foreground">Tools</h2>
              <div className="flex flex-wrap gap-1.5">
                {usedTools.slice(0, 8).map((tool) => (
                  <span key={tool} className="rounded-md bg-accent/50 px-2 py-0.5 text-xs text-muted-foreground">
                    {tool}
                  </span>
                ))}
                {usedTools.length > 8 && (
                  <span className="rounded-md bg-accent/50 px-2 py-0.5 text-xs text-muted-foreground">
                    +{usedTools.length - 8} more
                  </span>
                )}
              </div>
            </section>
          )}

          {/* Labels */}
          <section>
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">Labels</h2>
            <button className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground">
              <Tag className="h-4 w-4" />
              <span>Add label</span>
            </button>
          </section>
        </div>
      </aside>
    </div>
  );
}

function SidebarItem({ icon, label, link }: { icon: React.ReactNode; label: string; link?: string }) {
  const content = (
    <div className="flex items-center gap-2 text-muted-foreground">
      {icon}
      <span>{label}</span>
    </div>
  );

  if (link) {
    return (
      <Link to={link} className="block transition-colors hover:text-foreground">
        {content}
      </Link>
    );
  }

  return content;
}

interface MessageNavigatorProps {
  userMessages: Array<{ index: number; text: string }>;
}

function MessageNavigator({ userMessages }: MessageNavigatorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [visibleIndex, setVisibleIndex] = useState<number | null>(null);

  // Set up Intersection Observer to track visible user messages
  useEffect(() => {
    if (userMessages.length === 0) return;

    const observers: IntersectionObserver[] = [];
    const visibilityMap = new Map<number, boolean>();

    for (const msg of userMessages) {
      const messageId = `msg-${msg.index + 1}`;
      const element = document.getElementById(messageId);
      if (!element) continue;

      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            visibilityMap.set(msg.index, entry.isIntersecting);
          }
          // Find the first visible message
          for (const m of userMessages) {
            if (visibilityMap.get(m.index)) {
              setVisibleIndex(m.index);
              return;
            }
          }
        },
        { threshold: 0.1, rootMargin: "-20% 0px -60% 0px" },
      );

      observer.observe(element);
      observers.push(observer);
    }

    return () => {
      for (const observer of observers) {
        observer.disconnect();
      }
    };
  }, [userMessages]);

  const scrollToMessage = (index: number) => {
    const messageId = `msg-${index + 1}`;
    const target = document.getElementById(messageId);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      window.history.pushState({}, "", `#${messageId}`);
    }
    setIsOpen(false);
  };

  if (userMessages.length === 0) return null;

  return (
    <div className="fixed left-4 top-1/2 z-50 hidden -translate-y-1/2 lg:block">
      <div className="relative">
        {/* Dynamic lines indicator */}
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex flex-col items-center gap-1 rounded-lg border border-border bg-background/95 px-2 py-2.5 shadow-lg backdrop-blur transition-colors hover:bg-accent"
          title="Jump to message"
        >
          {userMessages.map((msg) => (
            <div
              key={msg.index}
              className={`h-0.5 w-5 rounded-full transition-colors ${
                visibleIndex === msg.index ? "bg-white" : "bg-muted-foreground/40"
              }`}
            />
          ))}
        </button>

        {isOpen && (
          <div className="absolute left-12 top-0 w-72 rounded-lg border border-border bg-background/95 p-3 shadow-xl backdrop-blur">
            <ol className="space-y-2">
              {userMessages.map((msg, i) => (
                <li key={msg.index}>
                  <button
                    onClick={() => scrollToMessage(msg.index)}
                    className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent ${
                      visibleIndex === msg.index ? "bg-accent/50" : ""
                    }`}
                  >
                    <span className="shrink-0 text-muted-foreground">{i + 1}.</span>
                    <span className="line-clamp-1">
                      {msg.text.slice(0, 50)}
                      {msg.text.length > 50 ? "..." : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
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
            className="max-h-64 max-w-full rounded-lg border border-border object-contain hover:border-primary"
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
  userImage: string | null;
  userName: string | null;
}

function MessageBlock({ message, index, userImage, userName }: MessageBlockProps) {
  const messageId = `msg-${index + 1}`;

  // User message - dark pill with avatar
  if (message.type === "user") {
    // Skip internal system messages
    if (isInternalMessage(message.text)) {
      return null;
    }

    return (
      <div id={messageId} className="flex items-start gap-3">
        <Avatar className="mt-1 h-8 w-8 shrink-0">
          <AvatarImage src={userImage || undefined} alt={userName || "User"} />
          <AvatarFallback className="text-xs">{getInitials(userName)}</AvatarFallback>
        </Avatar>
        <div className="rounded-2xl bg-secondary/60 px-4 py-2.5">
          <p className="text-sm whitespace-pre-wrap">{message.text}</p>
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
      />
    );
  }

  // Agent response - rendered text
  if (message.type === "agent") {
    return (
      <div id={messageId} className="prose prose-invert prose-sm max-w-none">
        <AgentText text={message.text} />
      </div>
    );
  }

  // Compaction summary
  if (message.type === "compaction-summary") {
    return (
      <div id={messageId} className="text-sm text-muted-foreground italic">
        {message.text}
      </div>
    );
  }

  // Command (slash command)
  if (message.type === "command") {
    return (
      <div id={messageId} className="flex items-start gap-3">
        <div className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-secondary/60">
          <Terminal className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="rounded-2xl bg-secondary/60 px-4 py-2.5">
          <code className="text-sm font-mono">
            {message.name}
            {message.args && <span className="text-muted-foreground"> {message.args}</span>}
          </code>
          {message.output && (
            <pre className="mt-2 text-xs text-muted-foreground whitespace-pre-wrap">{message.output}</pre>
          )}
        </div>
      </div>
    );
  }

  return null;
}

function ThinkingBlock({ messageId, text }: { messageId: string; text: string }) {
  return (
    <Collapsible id={messageId} defaultOpen={false}>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 py-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
        <ChevronRight className="h-4 w-4 transition-transform [[data-state=open]>&]:rotate-90" />
        <span>Thinking</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 rounded-lg border border-border/50 bg-muted/30 p-4 text-sm text-muted-foreground">
          <pre className="font-sans whitespace-pre-wrap">{text}</pre>
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
}

function ToolCallBlock({ messageId, toolName, input, output, error, isError }: ToolCallBlockProps) {
  const Icon = getToolIcon(toolName);
  const description = getToolDescription(toolName, input);

  // Extract images from input/output
  const inputImages = extractImageReferences(input);
  const outputImages = extractImageReferences(output);

  return (
    <Collapsible id={messageId} defaultOpen={false}>
      <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-3 rounded-lg bg-zinc-900 px-4 py-3 text-left transition-colors hover:bg-zinc-800">
        <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
        <code className="min-w-0 flex-1 text-sm text-muted-foreground">
          {description || toolName || "Unknown Tool"}
        </code>
        {(error || isError) && (
          <span className="shrink-0 rounded bg-destructive/20 px-1.5 py-0.5 text-xs text-destructive">Error</span>
        )}
        <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform [[data-state=open]>&]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="mt-2 space-y-3 rounded-lg bg-zinc-900/50 p-4">
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
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

// Render agent text with basic markdown-like formatting
function AgentText({ text }: { text: string }) {
  // Split into lines for processing
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let currentParagraph: string[] = [];
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let listItems: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const flushParagraph = () => {
    if (currentParagraph.length > 0) {
      const content = currentParagraph.join(" ");
      elements.push(
        <p key={elements.length} className="mb-3 leading-relaxed">
          {renderInlineFormatting(content)}
        </p>,
      );
      currentParagraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      const ListTag = listType === "ol" ? "ol" : "ul";
      elements.push(
        <ListTag
          key={elements.length}
          className={`mb-3 space-y-1 ${listType === "ol" ? "list-decimal" : "list-disc"} pl-5`}
        >
          {listItems.map((item, i) => (
            <li key={i}>{renderInlineFormatting(item)}</li>
          ))}
        </ListTag>,
      );
      listItems = [];
      listType = null;
    }
  };

  for (const line of lines) {
    // Code block start/end
    if (line.startsWith("```")) {
      if (!inCodeBlock) {
        flushParagraph();
        flushList();
        inCodeBlock = true;
        codeBlockContent = [];
      } else {
        elements.push(
          <pre key={elements.length} className="mb-3 overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm">
            <code>{codeBlockContent.join("\n")}</code>
          </pre>,
        );
        inCodeBlock = false;
        codeBlockContent = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Unordered list item
    if (line.match(/^[-*]\s+/)) {
      flushParagraph();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }

    // Ordered list item
    if (line.match(/^\d+\.\s+/)) {
      flushParagraph();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listItems.push(line.replace(/^\d+\.\s+/, ""));
      continue;
    }

    // Empty line - flush current paragraph
    if (line.trim() === "") {
      flushParagraph();
      flushList();
      continue;
    }

    // Regular line - add to current paragraph
    flushList();
    currentParagraph.push(line);
  }

  // Flush remaining content
  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <pre key={elements.length} className="mb-3 overflow-x-auto rounded-lg bg-zinc-900 p-4 text-sm">
        <code>{codeBlockContent.join("\n")}</code>
      </pre>,
    );
  }
  flushParagraph();
  flushList();

  return <>{elements}</>;
}

// Render inline formatting (bold, italic, code, links)
function renderInlineFormatting(text: string): React.ReactNode {
  // Simple regex-based inline formatting
  const parts: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      parts.push(
        <code key={key++} className="rounded bg-zinc-800 px-1.5 py-0.5 text-sm">
          {codeMatch[1]}
        </code>,
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      parts.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      parts.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Link
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      parts.push(
        <a
          key={key++}
          href={linkMatch[2]}
          className="text-primary hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          {linkMatch[1]}
        </a>,
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain text until next special character
    const nextSpecial = remaining.search(/[`*[]/);
    if (nextSpecial === -1) {
      parts.push(remaining);
      break;
    } else if (nextSpecial === 0) {
      // Special char that didn't match a pattern, treat as plain text
      parts.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      parts.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return parts.length === 1 ? parts[0] : <>{parts}</>;
}
