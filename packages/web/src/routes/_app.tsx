import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createFileRoute, Link, Outlet, redirect, useRouter } from "@tanstack/react-router";
import { ChevronDownIcon, LogOutIcon, LogsIcon, UsersIcon } from "lucide-react";
import React from "react";
import { authClient } from "../lib/auth-client";
import { getSession } from "../lib/server-functions";

export const Route = createFileRoute("/_app")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session) {
      throw redirect({ to: "/" });
    }
    // Waitlist users can't access the app
    if (session.user.role === "waitlist") {
      throw redirect({ to: "/waitlist" });
    }
    return { session };
  },
  component: AppLayout,
});

function AppLayout() {
  const { session } = Route.useRouteContext();
  const router = useRouter();
  const [isSigningIn, setIsSigningIn] = React.useState(false);

  const handleSignIn = async () => {
    setIsSigningIn(true);
    await authClient.signIn.social({
      provider: "github",
      callbackURL: "http://localhost:3000/app",
    });
  };

  const handleSignOut = async () => {
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
      <header className="flex h-16 items-center border-b border-white/10">
        {/* Logo */}
        <div className="flex items-center gap-2 p-4">
          <Link to="/app" className="text-lg font-semibold text-white/90 transition-colors hover:text-white">
            🔮
          </Link>
        </div>

        {/* Nav */}
        <nav className="flex flex-1 items-center gap-6">
          {isSigningIn ? (
            <div className="flex items-center gap-2 text-sm text-white/90">
              <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80"></div>
              <span>Redirecting to GitHub...</span>
            </div>
          ) : session ? (
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
                  <UsersIcon className="size-4" />
                  Admin
                </Link>
              )}
            </>
          ) : (
            <Button onClick={handleSignIn} size="sm" disabled={isSigningIn}>
              Sign in with GitHub
            </Button>
          )}
        </nav>

        {/* User menu */}
        {session && (
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
                <DropdownMenuItem onClick={handleSignOut}>
                  <LogOutIcon className="size-4" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </header>
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
