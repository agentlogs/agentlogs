import { createFileRoute, redirect } from "@tanstack/react-router";
import { Logo } from "../components/icons/source-icons";

export const Route = createFileRoute("/waitlist")({
  beforeLoad: ({ context }) => {
    const session = context.session;
    if (session?.user.role === "user" || session?.user.role === "admin") {
      throw redirect({ to: "/app" });
    }
    return { session };
  },
  component: WaitlistPage,
});

function WaitlistPage() {
  const { session } = Route.useRouteContext();

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <nav className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-6">
          <a href="/" className="flex items-center gap-2 font-medium">
            <Logo className="size-5" />
            AgentLogs
          </a>
          {session && <span className="text-sm text-muted-foreground">{session.user.email}</span>}
        </div>
      </nav>

      <main className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        {session ? (
          <>
            <div className="flex size-14 items-center justify-center rounded-full bg-green-500/10">
              <svg className="size-7 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h1 className="mt-5 font-display text-3xl tracking-tight sm:text-4xl">You're on the waitlist</h1>
            <p className="mt-3 max-w-md text-muted-foreground">
              Thanks for signing up, {session.user.name || "there"}! We'll notify you at{" "}
              <span className="text-foreground">{session.user.email}</span> when your account is ready.
            </p>
          </>
        ) : (
          <>
            <h1 className="font-display text-3xl tracking-tight sm:text-4xl">Join the Waitlist</h1>
            <p className="mt-3 max-w-md text-muted-foreground">Sign in with GitHub to join the waitlist.</p>
            <a
              href="/auth/github"
              className="mt-6 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              Sign in with GitHub
            </a>
          </>
        )}
      </main>
    </div>
  );
}
