import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDebugMode } from "@/hooks/use-debug-mode";
import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import {
  BookOpenIcon,
  ChevronDownIcon,
  LogOutIcon,
  LogsIcon,
  ScrollTextIcon,
  ShieldIcon,
  UsersIcon,
} from "lucide-react";
import { DiscordIcon, Logo } from "@/components/icons/source-icons";
import { authClient } from "../lib/auth-client";
import { clearSessionCache } from "../lib/session-cache";

export const Route = createFileRoute("/_app")({
  beforeLoad: ({ location, context }) => {
    // Use session from parent __root layout (already fetched)
    const session = context.session;

    // Allow unauthenticated access to public transcript pages and redirects
    const isPublicTranscriptRoute = location.pathname.startsWith("/app/logs/") || location.pathname.startsWith("/s/");

    if (!session) {
      if (isPublicTranscriptRoute) {
        // Allow access without session for public transcripts
        return { session: null };
      }

      // For device auth page, redirect to GitHub login with callback to return here
      if (location.pathname === "/app/device") {
        const callbackURL = location.href; // Preserves ?user_code=...
        throw redirect({ href: `/auth/github?callbackURL=${encodeURIComponent(callbackURL)}` });
      }

      throw redirect({ to: "/" });
    }
    // Waitlist users can't access the app (except public transcripts)
    if (session.user.role === "waitlist" && !isPublicTranscriptRoute) {
      throw redirect({ to: "/waitlist" });
    }
    return { session };
  },
  component: AppLayout,
});

function AppLayout() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const [debugMode, setDebugMode] = useDebugMode();

  const handleSignOut = async () => {
    clearSessionCache();
    await authClient.signOut({
      fetchOptions: {
        onSuccess: () => router.invalidate(),
      },
    });
  };

  const userInitials = session?.user.name
    ? session.user.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .toUpperCase()
        .slice(0, 2)
    : (session?.user.email?.slice(0, 2).toUpperCase() ?? "?");

  return (
    <div className="dark min-h-screen bg-background scheme-dark">
      <header className="flex h-12 items-center border-b border-white/10">
        {/* Logo */}
        <div className="flex items-center gap-2 px-4">
          <Link
            to="/app"
            className="flex items-center gap-2 text-lg font-semibold text-white/90 transition-colors hover:text-white"
          >
            <Logo className="size-5" />
            {!session && <span className="text-sm">AgentLogs</span>}
          </Link>
        </div>

        {/* Nav */}
        <nav className="ml-3 flex flex-1 items-center gap-3">
          {session && (
            <>
              <Link
                to="/app"
                activeOptions={{ exact: true }}
                className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-white data-[status=active]:text-white"
              >
                <LogsIcon className="size-4" />
                Logs
              </Link>
              <Link
                to="/app/team"
                className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-white data-[status=active]:text-white"
              >
                <UsersIcon className="size-4" />
                Team
              </Link>
              {session.user.role === "admin" && (
                <Link
                  to="/app/admin"
                  className="flex items-center gap-2 text-sm text-white/50 transition-colors hover:text-white data-[status=active]:text-white"
                >
                  <ShieldIcon className="size-4" />
                  Admin
                </Link>
              )}
            </>
          )}
        </nav>

        {/* User menu or Sign in/Join buttons */}
        {session ? (
          <div className="flex items-center gap-2 px-4">
            <DropdownMenu>
              <DropdownMenuTrigger className="flex cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1 ring-offset-background transition-colors outline-none hover:bg-accent/15 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
                {session.user.image ? (
                  <img
                    src={session.user.image}
                    alt={session.user.name ?? "User"}
                    className="size-6 rounded-full object-cover"
                  />
                ) : (
                  <Avatar size="sm">
                    <AvatarFallback>{userInitials}</AvatarFallback>
                  </Avatar>
                )}
                <ChevronDownIcon className="size-4 text-white/50" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={8} className="min-w-48">
                <div className="px-2 py-1.5 text-sm">
                  <div className="font-medium text-foreground">{session.user.name}</div>
                  <div className="text-xs text-muted-foreground">{session.user.email}</div>
                </div>
                <DropdownMenuSeparator />
                {session.user.role === "admin" && (
                  <>
                    <DropdownMenuCheckboxItem checked={debugMode} onCheckedChange={setDebugMode}>
                      Debug Mode
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => window.open("https://agentlogs.ai/docs", "_blank")}>
                  <BookOpenIcon className="size-4" />
                  Docs
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open("https://agentlogs.ai/docs/changelog", "_blank")}>
                  <ScrollTextIcon className="size-4" />
                  Changelog
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => window.open("https://discord.gg/yG4TNv3mjG", "_blank")}>
                  <DiscordIcon className="size-4" />
                  Support
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOutIcon className="size-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : (
          <div className="flex items-center gap-2 px-4">
            <Button variant="ghost" size="sm" asChild>
              <a href="/auth/github">Sign in</a>
            </Button>
            <Button size="sm" asChild>
              <a href="/auth/github">Join waitlist</a>
            </Button>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-4 py-4 md:px-6 md:py-8">
        <Outlet />
      </main>
    </div>
  );
}
