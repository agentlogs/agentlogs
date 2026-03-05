import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Check, Loader2, Mail, TrendingUp, TrendingDown } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getAdminPageData, sendWelcomeEmail, updateUserRole } from "../../../lib/server-functions";
import { userRoles, type UserRole } from "../../../db/schema";

export const Route = createFileRoute("/_app/app/admin")({
  beforeLoad: ({ context }) => {
    // Use session from parent _app layout (already fetched)
    if (!context.session || context.session.user.role !== "admin") {
      throw redirect({ to: "/app" });
    }
  },
  loader: () => getAdminPageData(),
  component: AdminPage,
});

interface StatCardProps {
  title: string;
  value: string | number;
  description?: string;
  trend?: { value: string; direction: "up" | "down" };
  footer?: string;
}

function StatCard({ title, value, description, trend, footer }: StatCardProps) {
  const TrendIcon = trend?.direction === "up" ? TrendingUp : TrendingDown;
  return (
    <Card className="@container/card">
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">{value}</CardTitle>
        {trend && (
          <CardAction>
            <Badge variant="outline">
              <TrendIcon className="size-3" />
              {trend.value}
            </Badge>
          </CardAction>
        )}
      </CardHeader>
      {(description || footer) && (
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          {description && (
            <div className="line-clamp-1 flex gap-2 font-medium">
              {description}
              {trend && <TrendIcon className="size-4" />}
            </div>
          )}
          {footer && <div className="text-muted-foreground">{footer}</div>}
        </CardFooter>
      )}
    </Card>
  );
}

function UserRoleSelect({ userId, initialRole }: { userId: string; initialRole: UserRole }) {
  const [role, setRole] = useState(initialRole);
  const [isLoading, setIsLoading] = useState(false);
  const [showCheck, setShowCheck] = useState(false);

  async function handleRoleChange(newRole: string) {
    if (newRole === role) return;

    setIsLoading(true);
    try {
      await updateUserRole({ data: { userId, role: newRole } });
      setRole(newRole as UserRole);
      setShowCheck(true);
      setTimeout(() => setShowCheck(false), 2000);
    } catch (error) {
      console.error("Failed to update role:", error);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={role} onValueChange={handleRoleChange} disabled={isLoading}>
        <SelectTrigger className="w-[100px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {userRoles.map((r) => (
            <SelectItem key={r} value={r} className="text-xs">
              {r}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {isLoading && <Loader2 className="size-4 animate-spin text-muted-foreground" />}
      {showCheck && !isLoading && <Check className="size-4 text-green-500" />}
    </div>
  );
}

function WelcomeEmailButton({ userId, initialSentAt }: { userId: string; initialSentAt: Date | string | null }) {
  const [sentAt, setSentAt] = useState<Date | string | null>(initialSentAt);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSend() {
    setIsLoading(true);
    setError(null);
    try {
      await sendWelcomeEmail({ data: { userId } });
      setSentAt(new Date());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to send welcome email:", message);
      setError(message);
    } finally {
      setIsLoading(false);
    }
  }

  const alreadySent = !!sentAt;
  const date = sentAt ? (typeof sentAt === "string" ? new Date(sentAt) : sentAt) : null;

  return (
    <div className="flex flex-col items-start gap-1">
      <Button variant="outline" size="sm" onClick={handleSend} disabled={isLoading} className="gap-1.5">
        {isLoading ? <Loader2 className="size-3 animate-spin" /> : <Mail className="size-3" />}
        {alreadySent ? "Resend" : "Send Welcome"}
      </Button>
      {alreadySent && date && <span className="text-xs text-muted-foreground">Sent {date.toLocaleDateString()}</span>}
      {error && <span className="text-xs text-red-500">{error}</span>}
    </div>
  );
}

function AdminPage() {
  const { stats, users } = Route.useLoaderData();

  const formatCost = (cost: number) => `$${cost.toFixed(2)}`;
  const formatNumber = (num: number) => num.toLocaleString();

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Admin Dashboard</h1>
        <p className="text-muted-foreground">Overview of all users and system statistics.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs md:grid-cols-2 lg:grid-cols-4 dark:*:data-[slot=card]:bg-card">
        <StatCard title="Total Users" value={formatNumber(stats.totalUsers ?? 0)} footer="All registered users" />
        <StatCard
          title="Waitlist"
          value={formatNumber(stats.waitlistUsers ?? 0)}
          description="Pending approval"
          footer="Awaiting access"
        />
        <StatCard
          title="Active Users"
          value={formatNumber(stats.activeUsers ?? 0)}
          description="With access"
          footer="Can use the platform"
        />
        <StatCard
          title="Admins"
          value={formatNumber(stats.adminUsers ?? 0)}
          description="Full access"
          footer="Platform administrators"
        />
      </div>

      <div className="grid gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs md:grid-cols-2 lg:grid-cols-4 dark:*:data-[slot=card]:bg-card">
        <StatCard title="Total Transcripts" value={formatNumber(stats.totalTranscripts ?? 0)} footer="All sessions" />
        <StatCard title="Total Repositories" value={formatNumber(stats.totalRepos ?? 0)} footer="Connected repos" />
        <StatCard
          title="Total Tokens"
          value={formatNumber(stats.totalTokens ?? 0)}
          description="All time usage"
          footer="Input + output tokens"
        />
        <StatCard
          title="Total Cost"
          value={formatCost(stats.totalCost ?? 0)}
          description="Estimated API cost"
          footer="Based on token usage"
        />
      </div>

      {/* Users Table */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">All Users</h2>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[250px]">User</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Welcome Email</TableHead>
                <TableHead className="text-right">Transcripts</TableHead>
                <TableHead className="text-right">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-8">
                        <AvatarImage src={user.image ?? undefined} alt={user.name} />
                        <AvatarFallback>{user.name?.charAt(0) ?? "?"}</AvatarFallback>
                      </Avatar>
                      <div className="flex flex-col">
                        <span className="font-medium">{user.name}</span>
                        {user.username && <span className="text-xs text-muted-foreground">@{user.username}</span>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{user.email}</TableCell>
                  <TableCell>
                    <UserRoleSelect userId={user.id} initialRole={user.role as UserRole} />
                  </TableCell>
                  <TableCell>
                    <WelcomeEmailButton userId={user.id} initialSentAt={user.welcomeEmailSentAt ?? null} />
                  </TableCell>
                  <TableCell className="text-right font-mono">{user.transcriptCount}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {new Date(user.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
