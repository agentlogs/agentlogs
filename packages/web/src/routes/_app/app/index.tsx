import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ChevronDown, FileCode, Folder, MessageSquare, Search, Terminal, Wrench } from "lucide-react";
import { ClaudeCodeIcon, CodexIcon, OpenCodeIcon } from "../../../components/icons/source-icons";
import { useMemo, useState } from "react";
import { getAllTranscripts } from "../../../lib/server-functions";

export const Route = createFileRoute("/_app/app/")({
  loader: async () => {
    try {
      const transcripts = await getAllTranscripts();
      return { transcripts };
    } catch (error) {
      console.error("Failed to load data:", error);
      throw error;
    }
  },
  component: HomeComponent,
  errorComponent: ErrorComponent,
});

function ErrorComponent({ error }: { error: Error }) {
  return (
    <div className="py-12 text-center">
      <h2 className="text-2xl font-bold text-red-600">Error</h2>
      <p className="mt-2 text-gray-600">{error.message}</p>
      {error.message.includes("Unauthorized") && (
        <p className="mt-4 text-sm text-gray-500">Please sign in with GitHub using the button in the header.</p>
      )}
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

function getInitials(name: string | null): string {
  if (!name) return "?";
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
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

function HomeComponent() {
  const { transcripts } = Route.useLoaderData();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<string>("all");

  // Get unique repos from transcripts for the filter
  const repoOptions = useMemo(() => {
    const uniqueRepos = new Map<string, string>();
    for (const t of transcripts) {
      if (t.repoName && t.repoId) {
        uniqueRepos.set(t.repoId, t.repoName);
      }
    }
    return Array.from(uniqueRepos.entries()).map(([id, name]) => ({ id, name }));
  }, [transcripts]);

  // Filter transcripts based on search and repo selection
  const filteredTranscripts = useMemo(() => {
    return transcripts.filter((t) => {
      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesPreview = t.preview?.toLowerCase().includes(query);
        const matchesRepo = t.repoName?.toLowerCase().includes(query);
        if (!matchesPreview && !matchesRepo) return false;
      }

      // Repo filter
      if (selectedRepo !== "all") {
        if (selectedRepo === "private") {
          if (t.repoId) return false;
        } else {
          if (t.repoId !== selectedRepo) return false;
        }
      }

      return true;
    });
  }, [transcripts, searchQuery, selectedRepo]);

  return (
    <div className="space-y-6">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-[300px]">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search threads..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={selectedRepo} onValueChange={setSelectedRepo}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="All repositories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All repositories</SelectItem>
            <SelectItem value="private">Private only</SelectItem>
            {repoOptions.map((repo) => (
              <SelectItem key={repo.id} value={repo.id}>
                {repo.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Transcript List */}
      {filteredTranscripts.length === 0 ? (
        <p className="text-muted-foreground py-8 text-center">
          {transcripts.length === 0
            ? "No transcripts yet. Start capturing transcripts!"
            : "No transcripts match your filters."}
        </p>
      ) : (
        <div className="space-y-4">
          {filteredTranscripts.map((transcript) => (
            <TranscriptItem key={transcript.id} transcript={transcript} />
          ))}
        </div>
      )}
    </div>
  );
}

type TranscriptData = Awaited<ReturnType<typeof getAllTranscripts>>[number];

function TranscriptItem({ transcript }: { transcript: TranscriptData }) {
  const [expanded, setExpanded] = useState(false);
  const timeAgo = formatTimeAgo(new Date(transcript.createdAt));

  return (
    <Link to="/transcripts/$id" params={{ id: transcript.id }} className="block group">
      <div className="flex gap-4 py-3 px-2 rounded-lg hover:bg-accent/50 transition-colors">
        {/* Avatar */}
        <Avatar className="h-10 w-10 shrink-0 self-center">
          <AvatarImage src={transcript.userImage || undefined} alt={transcript.userName || "User"} />
          <AvatarFallback>{getInitials(transcript.userName)}</AvatarFallback>
        </Avatar>

        {/* Content */}
        <div className="flex-1 min-w-0 space-y-1.5">
          {/* Preview */}
          {transcript.preview && (
            <div
              className={`bg-secondary/50 rounded-md px-3 py-2 text-sm text-muted-foreground ${
                !expanded ? "line-clamp-2" : ""
              }`}
            >
              {transcript.preview}
            </div>
          )}

          {/* Meta row */}
          <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
            {getSourceIcon(transcript.source, "h-3.5 w-3.5")}
            <span className="font-medium text-foreground/80">{transcript.userName || "Unknown"}</span>
            <span>{timeAgo}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {transcript.userMessageCount}
            </span>
            <span className="flex items-center gap-1">
              <Wrench className="h-3 w-3" />
              {transcript.toolCount}
            </span>
            {transcript.filesChanged > 0 && (
              <span className="flex items-center gap-1">
                <FileCode className="h-3 w-3" />
                {transcript.filesChanged}
              </span>
            )}
            {(transcript.linesAdded > 0 || transcript.linesRemoved > 0) && (
              <span>
                <span className="text-green-500">+{transcript.linesAdded}</span>
                <span className="mx-0.5">/</span>
                <span className="text-red-500">-{transcript.linesRemoved}</span>
              </span>
            )}
            {transcript.repoName && (
              <span className="flex items-center gap-1">
                <Folder className="h-3.5 w-3.5" />
                <span>
                  {transcript.repoName}
                  {transcript.branch && `:${transcript.branch}`}
                </span>
              </span>
            )}
            {transcript.costUsd > 0 && (
              <>
                <span>•</span>
                <span>${transcript.costUsd.toFixed(2)}</span>
              </>
            )}
          </div>
        </div>

        {/* Expand button */}
        {transcript.preview && transcript.preview.length > 150 && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="self-start p-1 hover:bg-accent rounded shrink-0"
          >
            <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`} />
          </button>
        )}
      </div>
    </Link>
  );
}
