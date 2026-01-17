import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Globe, Loader2, Lock, MessageSquare, Search, Terminal, Users } from "lucide-react";
import { ClaudeCodeIcon, CodexIcon, GitHubIcon, OpenCodeIcon } from "../../../components/icons/source-icons";
import { useCallback, useMemo, useState } from "react";
import { getTranscriptsPaginated } from "../../../lib/server-functions";
import { useInfiniteScroll } from "../../../hooks/use-infinite-scroll";
import { ClientOnly } from "../../../components/client-only";

const endOfListQuotes = [
  { text: "That's all, folks!", author: "Porky Pig" },
  { text: "The only way to do great work is to love what you do.", author: "Steve Jobs" },
  { text: "Simplicity is the ultimate sophistication.", author: "Leonardo da Vinci" },
  { text: "First, solve the problem. Then, write the code.", author: "John Johnson" },
  { text: "Code is like humor. When you have to explain it, it's bad.", author: "Cory House" },
  { text: "Any fool can write code that a computer can understand.", author: "Martin Fowler" },
  {
    text: "Programming is the art of telling another human what one wants the computer to do.",
    author: "Donald Knuth",
  },
  { text: "The best error message is the one that never shows up.", author: "Thomas Fuchs" },
  { text: "Debugging is twice as hard as writing the code in the first place.", author: "Brian Kernighan" },
  { text: "You have reached the end of the internet. Please go outside.", author: "Anonymous" },
] as const;

// Persist quote selection in module scope, only initialized on client
let selectedQuoteIndex: number | null = null;
function getQuoteIndex() {
  if (selectedQuoteIndex === null) {
    selectedQuoteIndex = Math.floor(Math.random() * endOfListQuotes.length);
  }
  return selectedQuoteIndex;
}

function EndOfListQuote() {
  const quote = endOfListQuotes[getQuoteIndex()];
  return (
    <p className="py-4 text-center text-sm">
      <span className="text-muted-foreground italic">{`\u201C${quote.text}\u201D`}</span>
      <span className="ml-2 text-muted-foreground/60">— {quote.author}</span>
    </p>
  );
}

type DailyCount = { date: string; count: number };

function getDailyCounts(transcripts: { createdAt: Date }[], days = 30): DailyCount[] {
  const counts = new Map<string, number>();

  // Initialize all days with 0
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(date.getDate() - i);
    const key = date.toISOString().split("T")[0];
    counts.set(key, 0);
  }

  // Count transcripts per day
  for (const t of transcripts) {
    const key = new Date(t.createdAt).toISOString().split("T")[0];
    if (counts.has(key)) {
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }

  return Array.from(counts.entries()).map(([date, count]) => ({ date, count }));
}

function formatDateShort(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function ActivityChart({ data }: { data: DailyCount[] }) {
  const maxCount = Math.max(...data.map((d) => d.count), 1);

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-6 items-end gap-0.5">
        {data.map((d) => {
          const height = d.count > 0 ? Math.max((d.count / maxCount) * 100, 15) : 0;
          return (
            <Tooltip key={d.date}>
              <TooltipTrigger asChild>
                <div
                  className="w-1.5 bg-primary/50 transition-all hover:bg-primary"
                  style={{
                    height: d.count > 0 ? `${height}%` : "2px",
                    opacity: d.count > 0 ? 1 : 0.15,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent>
                <p>
                  {formatDateShort(d.date)}: {d.count} {d.count === 1 ? "log" : "logs"}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}

export const Route = createFileRoute("/_app/app/")({
  loader: async () => {
    try {
      const initialData = await getTranscriptsPaginated({ data: {} });
      return { initialData };
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

function getVisibilityIcon(visibility: string) {
  switch (visibility) {
    case "public":
      return <Globe className="h-3.5 w-3.5 text-emerald-500/60" />;
    case "team":
      return <Users className="h-3.5 w-3.5 text-sky-400/60" />;
    case "private":
    default:
      return <Lock className="h-3.5 w-3.5 text-muted-foreground/60" />;
  }
}

function HomeComponent() {
  const { initialData } = Route.useLoaderData();
  const [transcripts, setTranscripts] = useState(initialData.items);
  const [cursor, setCursor] = useState(initialData.nextCursor);
  const [hasMore, setHasMore] = useState(initialData.hasMore);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<string>("all");

  const fetchNextPage = useCallback(async () => {
    if (!cursor || isLoading) return;
    setIsLoading(true);
    try {
      const result = await getTranscriptsPaginated({ data: { cursor } });
      setTranscripts((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } finally {
      setIsLoading(false);
    }
  }, [cursor, isLoading]);

  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: fetchNextPage,
    hasMore,
    isLoading,
  });

  // Calculate daily activity data
  const dailyCounts = useMemo(() => getDailyCounts(transcripts, 30), [transcripts]);

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
      {/* Filters + Activity Chart */}
      <div className="flex items-center gap-4 pl-15">
        <div className="relative min-w-[300px]">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={selectedRepo} onValueChange={setSelectedRepo}>
          <SelectTrigger className="w-[200px]">
            <SelectValue>
              {selectedRepo === "all"
                ? "All repositories"
                : selectedRepo === "private"
                  ? "Private only"
                  : (() => {
                      const repo = repoOptions.find((r) => r.id === selectedRepo);
                      return repo ? (
                        <span className="flex items-center gap-1.5">
                          <GitHubIcon className="h-3.5 w-3.5 text-muted-foreground" />
                          {repo.name.replace(/^github\.com\//, "")}
                        </span>
                      ) : (
                        "All repositories"
                      );
                    })()}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All repositories</SelectItem>
            <SelectItem value="private">Private only</SelectItem>
            {repoOptions.map((repo) => (
              <SelectItem key={repo.id} value={repo.id}>
                <span className="flex items-center gap-1.5">
                  <GitHubIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  {repo.name.replace(/^github\.com\//, "")}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="grow" />

        <ActivityChart data={dailyCounts} />
      </div>

      {/* Transcript List */}
      {filteredTranscripts.length === 0 && !isLoading ? (
        <p className="py-8 text-center text-muted-foreground">
          {transcripts.length === 0
            ? "No transcripts yet. Start capturing transcripts!"
            : "No transcripts match your filters."}
        </p>
      ) : (
        <div className="space-y-4">
          {filteredTranscripts.map((transcript) => (
            <TranscriptItem key={transcript.id} transcript={transcript} />
          ))}

          {/* Loading indicator */}
          {isLoading && (
            <div className="flex justify-center py-4">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Scroll sentinel */}
          <div ref={sentinelRef} className="h-px" aria-hidden="true" />

          {/* End of list indicator */}
          {!hasMore && transcripts.length > 0 && (
            <ClientOnly>
              <EndOfListQuote />
            </ClientOnly>
          )}
        </div>
      )}
    </div>
  );
}

type TranscriptData = Awaited<ReturnType<typeof getTranscriptsPaginated>>["items"][number];

function TranscriptItem({ transcript }: { transcript: TranscriptData }) {
  const timeAgo = formatTimeAgo(new Date(transcript.createdAt));

  return (
    <Link to="/app/logs/$id" params={{ id: transcript.id }} className="group block">
      <div className="flex gap-4 rounded-lg px-2 py-3 transition-colors hover:bg-accent/15">
        {/* Avatar */}
        <Avatar className="h-10 w-10 shrink-0 self-center">
          <AvatarImage src={transcript.userImage || undefined} alt={transcript.userName || "User"} />
          <AvatarFallback>{getInitials(transcript.userName)}</AvatarFallback>
        </Avatar>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Summary */}
          {transcript.summary && <p className="text-sm font-medium">{transcript.summary}</p>}

          {/* Preview */}
          {transcript.preview && (
            <div className="truncate rounded-md bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
              {transcript.preview}
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {getSourceIcon(transcript.source, "h-3.5 w-3.5")}
            {getVisibilityIcon(transcript.visibility)}
            <span className="font-medium text-foreground/80">{transcript.userName || "Unknown"}</span>
            <span>{timeAgo}</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" />
              {transcript.userMessageCount}
            </span>
            {(transcript.linesAdded > 0 || transcript.linesRemoved > 0 || transcript.linesModified > 0) && (
              <span className="flex items-center gap-1">
                {transcript.linesAdded > 0 && <span className="text-green-500">+{transcript.linesAdded}</span>}
                {transcript.linesModified > 0 && <span className="text-yellow-500">~{transcript.linesModified}</span>}
                {transcript.linesRemoved > 0 && <span className="text-red-500">-{transcript.linesRemoved}</span>}
              </span>
            )}
            {transcript.repoName && (
              <>
                <span>•</span>
                <span className="flex items-center gap-1">
                  <GitHubIcon className="h-3.5 w-3.5" />
                  <span>
                    <span className="text-foreground/80">{transcript.repoName.replace(/^github\.com\//, "")}</span>
                    {transcript.branch && `@${transcript.branch}`}
                  </span>
                </span>
              </>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
