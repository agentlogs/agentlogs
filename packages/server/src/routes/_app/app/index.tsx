import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Globe, Loader2, Lock, MessageSquare, Search, Terminal } from "lucide-react";
import {
  ClaudeCodeIcon,
  ClineIcon,
  CodexIcon,
  GitHubIcon,
  OpenCodeIcon,
  PiIcon,
} from "../../../components/icons/source-icons";
import { useCallback, useEffect, useRef, useState } from "react";
import { getHomePageData, getTranscriptsPaginated } from "../../../lib/server-functions";
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
  loader: () => getHomePageData(),
  staleTime: 0,
  preloadStaleTime: 30_000,
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

function getSourceIcon(source: string, className?: string) {
  switch (source) {
    case "codex":
      return <CodexIcon className={className} />;
    case "claude-code":
      return <ClaudeCodeIcon className={className} />;
    case "cline":
      return <ClineIcon className={className} />;
    case "opencode":
      return <OpenCodeIcon className={className} />;
    case "pi":
      return <PiIcon className={className} />;
    default:
      return <Terminal className={className} />;
  }
}

function VisibilityBadge({ visibility }: { visibility: string }) {
  if (visibility === "public") {
    return (
      <Badge variant="secondary" className="h-4 gap-1 px-1.5 text-[10px]">
        <Globe className="h-2 w-2" />
        Public
      </Badge>
    );
  }
  if (visibility === "private") {
    return (
      <Badge variant="outline" className="h-4 gap-1 px-1.5 text-[10px]">
        <Lock className="h-2 w-2" />
        Private
      </Badge>
    );
  }
  return null;
}

function HomeComponent() {
  const { initialData, dailyActivity, repos } = Route.useLoaderData();
  const [transcripts, setTranscripts] = useState(initialData.items);
  const [cursor, setCursor] = useState(initialData.nextCursor);
  const [hasMore, setHasMore] = useState(initialData.hasMore);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedRepo, setSelectedRepo] = useState<string>("all");
  const isInitialMount = useRef(true);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Get filter params for API calls
  const getFilterParams = useCallback(() => {
    const params: { search?: string; repoId?: string | null } = {};
    if (debouncedSearch) params.search = debouncedSearch;
    if (selectedRepo === "private") params.repoId = null;
    else if (selectedRepo !== "all") params.repoId = selectedRepo;
    return params;
  }, [debouncedSearch, selectedRepo]);

  // Refetch when filters change
  useEffect(() => {
    // Skip initial mount since we already have data from loader
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }

    const refetch = async () => {
      setIsLoading(true);
      try {
        const result = await getTranscriptsPaginated({ data: getFilterParams() });
        setTranscripts(result.items);
        setCursor(result.nextCursor);
        setHasMore(result.hasMore);
      } finally {
        setIsLoading(false);
      }
    };
    refetch();
  }, [debouncedSearch, selectedRepo, getFilterParams]);

  const fetchNextPage = useCallback(async () => {
    if (!cursor || isLoading) return;
    setIsLoading(true);
    try {
      const result = await getTranscriptsPaginated({ data: { cursor, ...getFilterParams() } });
      setTranscripts((prev) => [...prev, ...result.items]);
      setCursor(result.nextCursor);
      setHasMore(result.hasMore);
    } finally {
      setIsLoading(false);
    }
  }, [cursor, isLoading, getFilterParams]);

  const { sentinelRef } = useInfiniteScroll({
    onLoadMore: fetchNextPage,
    hasMore,
    isLoading,
  });

  // Build repo options from fetched repos
  const repoOptions = repos.map((r) => ({ id: r.id, name: r.repo }));

  return (
    <div className="space-y-6">
      {/* Filters + Activity Chart */}
      <div className="flex items-center gap-3 px-2 md:gap-4 md:pl-16">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={selectedRepo} onValueChange={setSelectedRepo}>
          <SelectTrigger className="w-[160px] shrink-0 sm:w-[200px]">
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

        <div className="hidden lg:block lg:grow" />

        <div className="hidden lg:block">
          <ActivityChart data={dailyActivity} />
        </div>
      </div>

      {/* Transcript List */}
      {transcripts.length === 0 && !isLoading ? (
        <p className="py-8 text-center text-muted-foreground">
          {debouncedSearch || selectedRepo !== "all"
            ? "No transcripts match your filters."
            : "No transcripts yet. Start capturing transcripts!"}
        </p>
      ) : (
        <div className="space-y-4">
          {transcripts.map((transcript) => (
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
      <div className="flex gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-accent/15 sm:gap-4">
        {/* Avatar */}
        <img
          src={transcript.userImage || undefined}
          alt={transcript.userName || "User"}
          className="h-8 w-8 shrink-0 self-start rounded-full sm:h-10 sm:w-10 sm:self-center"
        />

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-1.5">
          {/* Summary */}
          {transcript.summary && (
            <div className="flex items-center gap-2">
              <p className="line-clamp-2 text-sm font-medium sm:line-clamp-1">{transcript.summary}</p>
              <VisibilityBadge visibility={transcript.visibility} />
            </div>
          )}

          {/* Preview */}
          {transcript.preview && (
            <div className="line-clamp-2 rounded-md bg-secondary/50 px-2 py-1.5 text-sm text-muted-foreground sm:truncate sm:px-3 sm:py-2">
              {transcript.preview}
            </div>
          )}

          {/* Meta row */}
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:text-sm">
            <span className="flex items-center gap-1.5">
              {getSourceIcon(transcript.source, "h-3.5 w-3.5")}
              <span className="font-medium text-foreground/80">{transcript.userName || "Unknown"}</span>
            </span>
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
                    <span className="hidden sm:inline">{transcript.branch && `:${transcript.branch}`}</span>
                  </span>
                </span>
              </>
            )}
          </div>
        </div>

        {/* Preview image thumbnail - hidden on smaller screens */}
        {transcript.previewBlobSha256 && (
          <img
            src={`/api/blobs/${transcript.previewBlobSha256}`}
            alt=""
            className="hidden max-h-22 w-auto max-w-40 shrink-0 rounded-md border border-border object-contain md:block"
            loading="lazy"
          />
        )}
      </div>
    </Link>
  );
}
