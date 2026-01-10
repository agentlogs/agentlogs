import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { UnifiedTranscriptMessage } from "@vibeinsights/shared/claudecode";
import { unifiedTranscriptSchema } from "@vibeinsights/shared/schemas";
import { useEffect, useState } from "react";
import {
  extractImageReferences,
  getToolSummary,
  replaceImageReferencesForDisplay,
  type ImageReference,
} from "../lib/message-utils";
import { getTranscript } from "../lib/server-functions";

export const Route = createFileRoute("/transcripts/$id")({
  loader: ({ params }) => getTranscript({ data: params.id }),
  component: TranscriptDetailComponent,
});

function TranscriptDetailComponent() {
  const data = Route.useLoaderData();

  // Parse and validate the unified transcript
  const unifiedTranscript = unifiedTranscriptSchema.parse(data.unifiedTranscript);
  const sourceLabel = (() => {
    switch (data.source) {
      case "codex":
        return "Codex";
      case "claude-code":
        return "Claude Code";
      default:
        return "Unknown";
    }
  })();

  // Auto-scroll to message if hash is present in URL
  useEffect(() => {
    const hash = window.location.hash;
    if (hash) {
      // Small delay to ensure DOM is ready
      setTimeout(() => {
        const target = document.querySelector(hash);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, []);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        {data.repoId && (
          <Button variant="ghost" size="sm" asChild>
            <Link to="/repos/$id" params={{ id: data.repoId }}>
              ← Back to Repository
            </Link>
          </Button>
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={data.userImage || undefined} alt={data.userName || "User"} />
              <AvatarFallback>
                {data.userName
                  ? data.userName
                      .split(" ")
                      .map((n: string) => n[0] ?? "")
                      .join("")
                      .toUpperCase()
                      .slice(0, 2)
                  : "U"}
              </AvatarFallback>
            </Avatar>
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Transcript</h2>
              <p className="text-sm text-muted-foreground">{data.userName || "Unknown User"}</p>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            {unifiedTranscript.messageCount} messages • ${unifiedTranscript.costUsd.toFixed(4)}
          </div>
        </div>
        {unifiedTranscript.preview && <p className="text-sm text-muted-foreground">{unifiedTranscript.preview}</p>}
        <div className="flex gap-4 text-sm text-muted-foreground">
          <div>
            <span className="font-medium">Conversation:</span> {new Date(data.createdAt).toLocaleString()}
          </div>
          <div>
            <span className="font-medium">Last Updated:</span> {new Date(data.updatedAt).toLocaleString()}
          </div>
          <div>
            <span className="font-medium">Source:</span> {sourceLabel}
          </div>
        </div>
      </div>

      <div>
        <h3 className="mb-4 text-lg font-semibold">Messages</h3>
        {unifiedTranscript.messages.map((message, i) => (
          <MessageCard key={i} message={message} index={i} />
        ))}
      </div>
    </div>
  );
}

function ImageGallery({ images }: { images: ImageReference[] }) {
  if (images.length === 0) return null;

  return (
    <div className="mt-2 flex flex-wrap gap-2">
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
            className="max-h-64 max-w-full rounded border border-border object-contain hover:border-primary"
            loading="lazy"
          />
        </a>
      ))}
    </div>
  );
}

function MessageCard({ message, index }: { message: UnifiedTranscriptMessage; index: number }) {
  const [copied, setCopied] = useState(false);
  const shouldCollapse = message.type === "tool-call" || message.type === "thinking";
  const messageId = `msg-${index + 1}`;

  // Extract images from tool call input/output
  const inputImages = message.type === "tool-call" ? extractImageReferences(message.input) : [];
  const outputImages = message.type === "tool-call" ? extractImageReferences(message.output) : [];

  const getTypeColor = () => {
    if (message.type === "user") {
      return "bg-primary/10 [border-left-color:var(--color-primary)]";
    }

    if (message.type === "agent") {
      return "bg-secondary/10 [border-left-color:var(--color-secondary)]";
    }

    if (message.type === "thinking") {
      return "bg-muted/40 [border-left-color:var(--color-muted-foreground)]";
    }

    if (message.type === "tool-call") {
      return message.error || message.isError
        ? "bg-destructive/10 [border-left-color:var(--color-destructive)]"
        : "bg-accent/10 [border-left-color:var(--color-accent)]";
    }

    return "bg-muted/10 [border-left-color:var(--color-border)]";
  };

  const copyLink = async (e: React.MouseEvent) => {
    // Prevent the click from bubbling up to CollapsibleTrigger
    e.stopPropagation();

    const url = `${window.location.origin}${window.location.pathname}#${messageId}`;
    await navigator.clipboard.writeText(url);

    // Update URL in address bar to show the link
    window.history.pushState({}, "", `#${messageId}`);

    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // For non-collapsible messages (user/agent), render directly
  if (!shouldCollapse) {
    return (
      <Card id={messageId} className={cn("transition-colors", getTypeColor())}>
        <CardContent className="pt-6">
          <div className="mb-3 flex items-center justify-between">
            <Badge variant="outline">
              #{index + 1} {message.type}
            </Badge>
            <div className="flex items-center gap-2">
              <button
                onClick={copyLink}
                className="cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground hover:opacity-100"
                title="Copy link to this message"
              >
                {copied ? "✓ Copied!" : "🔗"}
              </button>
              {message.timestamp && (
                <span className="text-xs text-muted-foreground">
                  {new Date(message.timestamp).toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>

          {message.type === "user" && (
            <pre className="rounded border bg-background/50 p-3 text-sm whitespace-pre-wrap">{message.text}</pre>
          )}

          {message.type === "agent" && (
            <div className="rounded border bg-background/50 p-3 text-sm whitespace-pre-wrap">{message.text}</div>
          )}
        </CardContent>
      </Card>
    );
  }

  // For collapsible messages (tool-call/thinking), use Collapsible component
  return (
    <Card id={messageId} className={cn("transition-colors", getTypeColor())}>
      <CardContent className="pt-6">
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger asChild>
            <div className="-m-2 mb-3 flex w-full cursor-pointer items-center justify-between rounded p-2 hover:bg-accent/50">
              <div className="flex items-center gap-2">
                <Badge variant="outline">
                  #{index + 1} {message.type}
                </Badge>

                {/* Show summary for collapsed tool calls */}
                {message.type === "tool-call" && (
                  <span className="text-sm">
                    {message.toolName} • {getToolSummary(message)}
                  </span>
                )}

                {/* Show preview for collapsed thinking blocks */}
                {message.type === "thinking" && (
                  <span className="text-sm text-muted-foreground">{message.text.slice(0, 60)}...</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={copyLink}
                  className="cursor-pointer text-xs text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:text-foreground hover:opacity-100"
                  title="Copy link to this message"
                >
                  {copied ? "✓ Copied!" : "🔗"}
                </button>
                {message.timestamp && (
                  <span className="text-xs text-muted-foreground">
                    {new Date(message.timestamp).toLocaleTimeString()}
                  </span>
                )}
              </div>
            </div>
          </CollapsibleTrigger>

          <CollapsibleContent className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0">
            {message.type === "thinking" && (
              <div className="rounded border bg-background/50 p-3 text-sm whitespace-pre-wrap text-muted-foreground italic">
                {message.text}
              </div>
            )}

            {message.type === "tool-call" && (
              <>
                <div className="mb-2 text-sm font-medium">
                  Tool: {message.toolName ?? "Unknown"}
                  {message.isError && (
                    <Badge className="ml-2" variant="destructive">
                      Error
                    </Badge>
                  )}
                </div>
                {message.input && (
                  <div className="mb-2">
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">Input:</div>
                    <pre className="overflow-x-auto rounded border bg-background/50 p-3 text-xs whitespace-pre-wrap">
                      {JSON.stringify(replaceImageReferencesForDisplay(message.input), null, 2)}
                    </pre>
                    <ImageGallery images={inputImages} />
                  </div>
                )}
                {message.output && (
                  <div>
                    <div className="mb-1 text-xs font-semibold text-muted-foreground">Output:</div>
                    <pre className="overflow-x-auto rounded border bg-background/50 p-3 text-xs whitespace-pre-wrap">
                      {JSON.stringify(replaceImageReferencesForDisplay(message.output), null, 2)}
                    </pre>
                    <ImageGallery images={outputImages} />
                  </div>
                )}
                {message.error && (
                  <div className="mt-2 rounded border bg-background/50 p-3 text-sm text-destructive">
                    Error: {message.error}
                  </div>
                )}
              </>
            )}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
