import { createDrizzle } from "@/db";
import { createFileRoute } from "@tanstack/react-router";
import { getModelDisplayName } from "@agentlogs/shared";
import { env } from "@/lib/env";
import { getPublicTranscript } from "../../db/queries";
import { logger } from "../../lib/logger";

// Cache for 1 year (immutable since content is based on transcript ID)
const CACHE_CONTROL = "public, max-age=31536000, s-maxage=31536000, immutable";

interface TranscriptData {
  summary: string | null;
  preview: string;
  userName: string | null;
  userUsername: string | null;
  userImage: string | null;
  source: string;
  linesAdded: number;
  linesRemoved: number;
  linesModified: number;
  model?: string | null;
  repoName?: string | null;
  branch?: string | null;
  messageCount?: number | null;
  createdAt?: Date | string | null;
}

// GitHub icon as SVG path
function GitHubIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#a1a1aa">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

// Claude Code icon (Anthropic logo)
function ClaudeCodeIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#a1a1aa">
      <path d="M11.376 24L10.776 23.544L10.44 22.8L10.776 21.312L11.16 19.392L11.472 17.856L11.76 15.96L11.928 15.336L11.904 15.288L11.784 15.312L10.344 17.28L8.16 20.232L6.432 22.056L6.024 22.224L5.304 21.864L5.376 21.192L5.784 20.616L8.16 17.568L9.6 15.672L10.536 14.592L10.512 14.448H10.464L4.128 18.576L3 18.72L2.496 18.264L2.568 17.52L2.808 17.28L4.704 15.96L9.432 13.32L9.504 13.08L9.432 12.96H9.192L8.4 12.912L5.712 12.84L3.384 12.744L1.104 12.624L0.528 12.504L0 11.784L0.048 11.424L0.528 11.112L1.224 11.16L2.736 11.28L5.016 11.424L6.672 11.52L9.12 11.784H9.504L9.552 11.616L9.432 11.52L9.336 11.424L6.96 9.84L4.416 8.16L3.072 7.176L2.352 6.672L1.992 6.216L1.848 5.208L2.496 4.488L3.384 4.56L3.6 4.608L4.488 5.304L6.384 6.768L8.88 8.616L9.24 8.904L9.408 8.808V8.736L9.24 8.472L7.896 6.024L6.456 3.528L5.808 2.496L5.64 1.872C5.576 1.656 5.544 1.416 5.544 1.152L6.288 0.144001L6.696 0L7.704 0.144001L8.112 0.504001L8.736 1.92L9.72 4.152L11.28 7.176L11.736 8.088L11.976 8.904L12.072 9.168H12.24V9.024L12.36 7.296L12.6 5.208L12.84 2.52L12.912 1.752L13.296 0.840001L14.04 0.360001L14.616 0.624001L15.096 1.32L15.024 1.752L14.76 3.6L14.184 6.504L13.824 8.472H14.04L14.28 8.208L15.264 6.912L16.92 4.848L17.64 4.032L18.504 3.12L19.056 2.688H20.088L20.832 3.816L20.496 4.992L19.44 6.336L18.552 7.464L17.28 9.168L16.512 10.536L16.584 10.632H16.752L19.608 10.008L21.168 9.744L22.992 9.432L23.832 9.816L23.928 10.2L23.592 11.016L21.624 11.496L19.32 11.952L15.888 12.768L15.84 12.792L15.888 12.864L17.424 13.008L18.096 13.056H19.728L22.752 13.272L23.544 13.8L24 14.424L23.928 14.928L22.704 15.528L21.072 15.144L17.232 14.232L15.936 13.92H15.744V14.016L16.848 15.096L18.84 16.896L21.36 19.224L21.48 19.8L21.168 20.28L20.832 20.232L18.624 18.552L17.76 17.808L15.84 16.2H15.72V16.368L16.152 17.016L18.504 20.544L18.624 21.624L18.456 21.96L17.832 22.176L17.184 22.056L15.792 20.136L14.376 17.952L13.224 16.008L13.104 16.104L12.408 23.352L12.096 23.712L11.376 24Z" />
    </svg>
  );
}

// Codex icon (OpenAI logo)
function CodexIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#a1a1aa">
      <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08-4.778 2.758a.795.795 0 0 0-.393.681zm1.097-2.365 2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5Z" />
    </svg>
  );
}

// OpenCode icon
function OpenCodeIcon() {
  return (
    <svg width="16" height="20" viewBox="0 0 32 40" fill="#a1a1aa">
      <path d="M24 32H8V16H24V32Z" fillOpacity="0.5" />
      <path d="M24 8H8V32H24V8ZM32 40H0V0H32V40Z" />
    </svg>
  );
}

// Pi icon
function PiIcon() {
  return (
    <svg width="20" height="20" viewBox="165.29 165.29 469.43 469.43" fill="#a1a1aa">
      <path
        fillRule="evenodd"
        d="M165.29 165.29H517.36V400H400V517.36H282.65V634.72H165.29ZM282.65 282.65V400H400V282.65Z"
      />
      <path d="M517.36 400H634.72V634.72H517.36Z" />
    </svg>
  );
}

// Get source icon component based on source string
function SourceIcon({ source }: { source: string }) {
  switch (source) {
    case "claude-code":
      return <ClaudeCodeIcon />;
    case "codex":
      return <CodexIcon />;
    case "opencode":
      return <OpenCodeIcon />;
    case "pi":
      return <PiIcon />;
    default:
      return null;
  }
}

// User icon (fallback when no avatar)
function UserIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="#a1a1aa">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

// Calendar icon for date
function CalendarIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#a1a1aa" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

// AgentLogs logo SVG path (from favicon.svg)
function AgentLogsLogo() {
  return (
    <svg width="32" height="32" viewBox="0 0 240 240">
      <path
        fill="#fafafa"
        d="M210.638 193h-40.374a2 2 0 0 1-1.876-1.307l-7.392-20a2 2 0 0 1 1.876-2.693h40.416a2 2 0 0 1 1.877 1.31l7.35 20a2 2 0 0 1-1.877 2.69ZM69.603 193H28.867a2 2 0 0 1-1.877-2.691l7.36-20A2 2 0 0 1 36.227 169H76.93a2 2 0 0 1 1.878 2.688l-7.327 20A2 2 0 0 1 69.603 193ZM188.24 132H51.289a2 2 0 0 1-1.88-2.684l7.285-20A2 2 0 0 1 58.572 108h122.36a2 2 0 0 1 1.879 1.314l7.306 20A2 2 0 0 1 188.24 132ZM165.836 71H73.694a2 2 0 0 1-1.878-2.688l7.323-20A2 2 0 0 1 81.017 47h77.422a2 2 0 0 1 1.876 1.306l7.397 20A2 2 0 0 1 165.836 71Z"
      />
    </svg>
  );
}

function formatDate(dateValue: Date | string | null | undefined): string {
  if (!dateValue) return "";
  const date = typeof dateValue === "string" ? new Date(dateValue) : dateValue;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function OgImage({ data }: { data: TranscriptData }) {
  const title = data.summary || data.preview || "Untitled Thread";
  const modelName = getModelDisplayName(data.model);

  // Truncate title if too long
  const maxTitleLength = 80;
  const displayTitle = title.length > maxTitleLength ? title.slice(0, maxTitleLength) + "..." : title;

  // Truncate preview for description (~2 lines at 24px)
  const maxPreviewLength = 100;
  const displayPreview =
    data.preview && data.preview !== title
      ? data.preview.length > maxPreviewLength
        ? data.preview.slice(0, maxPreviewLength) + "..."
        : data.preview
      : null;

  // Format repo name (show repo:branch format)
  const repoName = data.repoName?.replace(/^github\.com\//, "") || null;
  const repoDisplay = repoName ? (data.branch ? `${repoName}:${data.branch}` : repoName) : null;

  // Format date
  const displayDate = formatDate(data.createdAt);

  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        padding: "60px",
        backgroundColor: "#111113",
        fontFamily: "Inter, sans-serif",
        color: "#fafafa",
      }}
    >
      {/* Top section - user, agent+model, github repo */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "24px",
          marginBottom: "32px",
        }}
      >
        {/* User info */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          {data.userImage ? (
            <img
              src={data.userImage}
              width={24}
              height={24}
              style={{
                borderRadius: "9999px",
              }}
            />
          ) : (
            <UserIcon />
          )}
          {data.userUsername && (
            <span
              style={{
                fontSize: "20px",
                color: "#a1a1aa",
              }}
            >
              @{data.userUsername}
            </span>
          )}
        </div>

        {/* Agent icon + Model */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
          }}
        >
          <SourceIcon source={data.source} />
          {modelName && (
            <span
              style={{
                fontSize: "20px",
                color: "#a1a1aa",
              }}
            >
              {modelName}
            </span>
          )}
        </div>

        {/* GitHub repo */}
        {repoDisplay && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <GitHubIcon />
            <span
              style={{
                fontSize: "20px",
                color: "#a1a1aa",
              }}
            >
              {repoDisplay}
            </span>
          </div>
        )}
      </div>

      {/* Main title - vertically centered */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          justifyContent: "center",
        }}
      >
        {/* Date eyebrow */}
        {displayDate && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              marginBottom: "24px",
            }}
          >
            <CalendarIcon />
            <span style={{ fontSize: "20px", color: "#a1a1aa" }}>{displayDate}</span>
          </div>
        )}
        <h1
          style={{
            fontSize: "60px",
            fontFamily: "Instrument Serif, Georgia, serif",
            fontWeight: 400,
            lineHeight: 1.2,
            margin: 0,
            color: "#fafafa",
          }}
        >
          {displayTitle}
        </h1>
        {/* Preview text */}
        {displayPreview && (
          <p
            style={{
              fontSize: "28px",
              color: "#a1a1aa",
              marginTop: "24px",
              lineHeight: 1.5,
            }}
          >
            {displayPreview}
          </p>
        )}
      </div>

      {/* Bottom section - branding */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          marginTop: "auto",
        }}
      >
        {/* AgentLogs branding */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
          }}
        >
          <AgentLogsLogo />
          <span
            style={{
              fontSize: "28px",
              fontWeight: 600,
              color: "#fafafa",
            }}
          >
            AgentLogs
          </span>
        </div>
      </div>
    </div>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const Route = createFileRoute("/api/og/$id" as any)({
  server: {
    handlers: {
      GET: async ({ params }: { params: { id: string } }) => {
        // Strip .png suffix if present (e.g., "abc123.png" -> "abc123")
        const id = params.id.replace(/\.png$/, "");
        logger.debug("OG image request", { id, rawId: params.id });

        try {
          const db = createDrizzle(env.DB);

          // Only generate OG images for PUBLIC transcripts
          const transcript = await getPublicTranscript(db, id);

          if (!transcript) {
            return new Response("Not found", {
              status: 404,
              headers: { "Cache-Control": "public, max-age=60" }, // Cache 404s briefly
            });
          }

          const data: TranscriptData = {
            summary: transcript.summary,
            preview: transcript.preview ?? "",
            userName: transcript.userName,
            userUsername: transcript.userUsername,
            userImage: transcript.userImage,
            source: transcript.source,
            linesAdded: transcript.linesAdded ?? 0,
            linesRemoved: transcript.linesRemoved ?? 0,
            linesModified: transcript.linesModified ?? 0,
            model: transcript.model,
            repoName: transcript.repoName,
            branch: transcript.branch,
            messageCount: transcript.messageCount,
            createdAt: transcript.createdAt,
          };

          // Fetch fonts from external CDN for stable rendering across runtimes.
          const [serifResponse, sansResponse] = await Promise.all([
            fetch("https://cdn.jsdelivr.net/fontsource/fonts/instrument-serif@latest/latin-400-normal.ttf"),
            fetch("https://cdn.jsdelivr.net/fontsource/fonts/inter@latest/latin-400-normal.ttf"),
          ]);

          if (!serifResponse.ok || !sansResponse.ok) {
            logger.error(`Font fetch failed: serif=${serifResponse.status}, sans=${sansResponse.status}`);
            return new Response("Font loading failed", { status: 500 });
          }

          const [serifFont, sansFont] = await Promise.all([serifResponse.arrayBuffer(), sansResponse.arrayBuffer()]);

          const { ImageResponse } = await import("@vercel/og");
          const response = new ImageResponse(<OgImage data={data} />, {
            width: 1200,
            height: 630,
            fonts: [
              {
                name: "Instrument Serif",
                data: serifFont,
                style: "normal",
                weight: 400,
              },
              {
                name: "Inter",
                data: sansFont,
                style: "normal",
                weight: 400,
              },
            ],
          });

          // Add aggressive caching headers
          response.headers.set("Cache-Control", CACHE_CONTROL);
          response.headers.set("CDN-Cache-Control", CACHE_CONTROL);

          return response;
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          logger.error("OG image generation failed", { id, error: errorMessage });

          // WASM reinitialization error in dev mode - tell user to restart server
          if (errorMessage.includes("Already initialized")) {
            return new Response("OG image generation failed - restart dev server (HMR breaks WASM)", {
              status: 500,
              headers: { "Content-Type": "text/plain" },
            });
          }

          return new Response("Internal Server Error", { status: 500 });
        }
      },
      HEAD: async ({ params }: { params: { id: string } }) => {
        const id = params.id.replace(/\.png$/, "");

        try {
          const db = createDrizzle(env.DB);
          const transcript = await getPublicTranscript(db, id);
          if (!transcript) {
            return new Response(null, {
              status: 404,
              headers: { "Cache-Control": "public, max-age=60" },
            });
          }

          return new Response(null, {
            status: 200,
            headers: {
              "Content-Type": "image/png",
              "Cache-Control": CACHE_CONTROL,
            },
          });
        } catch (error) {
          logger.error("OG HEAD request failed", {
            id,
            error: error instanceof Error ? error.message : String(error),
          });
          return new Response(null, { status: 500 });
        }
      },
    },
  },
});
