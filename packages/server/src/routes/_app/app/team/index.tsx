import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { Check, Copy, Link, Mail, MoreHorizontal, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import {
  addMemberByEmail,
  createTeam,
  deleteTeam,
  generateInvite,
  getTeamDashboardData,
  leaveTeam,
  removeMember,
} from "../../../../lib/server-functions";
import { ClaudeCodeIcon, CodexIcon, OpenCodeIcon, PiIcon } from "../../../../components/icons/source-icons";
import { getModelDisplayName } from "@agentlogs/shared/models";

type PeriodDays = 1 | 7 | 30 | 90 | 365;

const PERIOD_OPTIONS: { value: PeriodDays; label: string }[] = [
  { value: 1, label: "24 Hours" },
  { value: 7, label: "7 Days" },
  { value: 30, label: "30 Days" },
  { value: 90, label: "90 Days" },
  { value: 365, label: "1 Year" },
];

export const Route = createFileRoute("/_app/app/team/")({
  loader: () => getTeamDashboardData({ data: { days: 30 } }),
  component: TeamDashboardPage,
});

const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "#f97316",
  "#22c55e",
  "#06b6d4",
];

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString();
}

function formatPeriod(period: string, isHourly: boolean): string {
  if (isHourly) {
    // Format: "2024-01-15 14:00" -> "2pm"
    const hour = parseInt(period.split(" ")[1]?.split(":")[0] ?? "0", 10);
    const ampm = hour >= 12 ? "pm" : "am";
    const hour12 = hour % 12 || 12;
    return `${hour12}${ampm}`;
  }
  // Format: "2024-01-15" -> "Jan 15"
  const date = new Date(period);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatPeriodFull(period: string, isHourly: boolean): string {
  if (isHourly) {
    // Format: "2024-01-15 14:00" -> "Jan 15, 2pm"
    const [datePart, timePart] = period.split(" ");
    const date = new Date(datePart);
    const hour = parseInt(timePart?.split(":")[0] ?? "0", 10);
    const ampm = hour >= 12 ? "pm" : "am";
    const hour12 = hour % 12 || 12;
    return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${hour12}${ampm}`;
  }
  const date = new Date(period);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getAgentDisplayName(agent: string): string {
  switch (agent?.toLowerCase()) {
    case "claude-code":
      return "Claude Code";
    case "codex":
      return "Codex CLI";
    case "opencode":
      return "OpenCode";
    default:
      return agent || "Unknown";
  }
}

function getAgentIcon(agent: string | null) {
  switch (agent?.toLowerCase()) {
    case "claude-code":
      return ClaudeCodeIcon;
    case "codex":
      return CodexIcon;
    case "opencode":
      return OpenCodeIcon;
    case "pi":
      return PiIcon;
    default:
      return null;
  }
}

function TeamDashboardPage() {
  const initialData = Route.useLoaderData();
  const router = useRouter();
  const [days, setDays] = useState<PeriodDays>(30);
  const [data, setData] = useState(initialData);
  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const { team, stats, memberStats, activity, userNames, isHourly, modelUsage, agentUsage, session } = data;

  const refresh = async () => {
    setIsLoading(true);
    try {
      const newData = await getTeamDashboardData({ data: { days } });
      setData(newData);
    } finally {
      setIsLoading(false);
    }
  };

  const handlePeriodChange = async (newDays: string) => {
    const d = Number(newDays) as PeriodDays;
    setDays(d);
    setIsLoading(true);
    try {
      const newData = await getTeamDashboardData({ data: { days: d } });
      setData(newData);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTeam = async () => {
    if (!team || !confirm("Are you sure you want to delete this team? All members will be removed.")) return;
    setIsDeleting(true);
    try {
      await deleteTeam({ data: team.id });
      router.invalidate();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLeaveTeam = async () => {
    if (!team || !confirm("Are you sure you want to leave this team?")) return;
    setIsLeaving(true);
    try {
      await leaveTeam({ data: team.id });
      router.invalidate();
    } finally {
      setIsLeaving(false);
    }
  };

  if (!team) {
    return <NoTeamView onSuccess={() => router.invalidate()} />;
  }

  const isOwner = session?.user?.id === team.ownerId;
  const hasActivity = activity.some((d) => {
    for (const key of Object.keys(d)) {
      if (key !== "period" && (d[key] as number) > 0) return true;
    }
    return false;
  });
  const periodLabel = PERIOD_OPTIONS.find((o) => o.value === days)?.label ?? "30 Days";

  // Build chart config for user activity
  const activityChartConfig: ChartConfig = {};
  for (let i = 0; i < userNames.length; i++) {
    const name = userNames[i] || "Unknown";
    activityChartConfig[name] = {
      label: name,
      color: CHART_COLORS[i % CHART_COLORS.length],
    };
  }

  // Prepare bar chart data
  const agentBarData = agentUsage.map((item) => ({
    name: getAgentDisplayName(item.agent),
    count: item.count,
  }));

  const modelBarData = modelUsage.slice(0, 10).map((item) => ({
    name: getModelDisplayName(item.model),
    count: item.count,
  }));

  return (
    <div className={`space-y-8 ${isLoading ? "opacity-60" : ""}`}>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{team.name}</h1>
          <p className="text-muted-foreground">
            {team.members.length} member{team.members.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={String(days)} onValueChange={handlePeriodChange}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder={periodLabel}>{periodLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isOwner ? (
                <DropdownMenuItem
                  onClick={handleDeleteTeam}
                  disabled={isDeleting}
                  className="whitespace-nowrap text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  {isDeleting ? "Deleting..." : "Delete Team"}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem onClick={handleLeaveTeam} disabled={isLeaving}>
                  <UserMinus className="h-4 w-4" />
                  {isLeaving ? "Leaving..." : "Leave Team"}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* Stats Cards - Simple stat cards */}
      <div className="grid gap-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs md:grid-cols-2 lg:grid-cols-4 dark:*:data-[slot=card]:bg-card">
        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Team Logs</CardDescription>
            <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
              {formatNumber(stats?.totalTranscripts ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardFooter className="text-sm text-muted-foreground">Total sessions in period</CardFooter>
        </Card>

        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Lines Added</CardDescription>
            <CardTitle className="text-2xl font-semibold text-green-500 tabular-nums @[250px]/card:text-3xl">
              +{formatNumber(stats?.linesAdded ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardFooter className="text-sm text-muted-foreground">New lines of code</CardFooter>
        </Card>

        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Lines Modified</CardDescription>
            <CardTitle className="text-2xl font-semibold text-yellow-500 tabular-nums @[250px]/card:text-3xl">
              ~{formatNumber(stats?.linesModified ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardFooter className="text-sm text-muted-foreground">Changed lines of code</CardFooter>
        </Card>

        <Card className="@container/card">
          <CardHeader>
            <CardDescription>Lines Removed</CardDescription>
            <CardTitle className="text-2xl font-semibold text-red-500 tabular-nums @[250px]/card:text-3xl">
              -{formatNumber(stats?.linesRemoved ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardFooter className="text-sm text-muted-foreground">Deleted lines of code</CardFooter>
        </Card>
      </div>

      {/* Activity Chart - Stacked area per user */}
      <Card className="pt-0">
        <CardHeader className="flex items-center gap-2 space-y-0 border-b py-5 sm:flex-row">
          <div className="grid flex-1 gap-1">
            <CardTitle>Team Activity</CardTitle>
            <CardDescription>{isHourly ? "Hourly" : "Daily"} logs by team member</CardDescription>
          </div>
        </CardHeader>
        <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
          {hasActivity ? (
            <ChartContainer config={activityChartConfig} className="aspect-auto h-[250px] w-full">
              <AreaChart data={activity}>
                <defs>
                  {userNames.map((name, i) => (
                    <linearGradient key={name} id={`fill-${i}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.8} />
                      <stop offset="95%" stopColor={CHART_COLORS[i % CHART_COLORS.length]} stopOpacity={0.1} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="period"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  minTickGap={32}
                  tickFormatter={(v) => formatPeriod(v, isHourly)}
                />
                <ChartTooltip
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      labelFormatter={(v) => formatPeriodFull(v as string, isHourly)}
                      indicator="dot"
                    />
                  }
                />
                {userNames.map((name, i) => (
                  <Area
                    key={name}
                    dataKey={name || "Unknown"}
                    type="natural"
                    fill={`url(#fill-${i})`}
                    stroke={CHART_COLORS[i % CHART_COLORS.length]}
                    stackId="a"
                  />
                ))}
                <ChartLegend content={<ChartLegendContent />} />
              </AreaChart>
            </ChartContainer>
          ) : (
            <div className="flex h-[250px] items-center justify-center text-muted-foreground">
              No team activity yet.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bar Charts Row */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* Agent Usage Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Agent Usage</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {agentBarData.length > 0 ? (
              <ChartContainer
                config={{ count: { label: "Logs", color: "var(--chart-1)" } }}
                className="w-full"
                style={{ height: `${Math.max(60, agentBarData.length * 28)}px` }}
              >
                <BarChart data={agentBarData} layout="vertical" margin={{ left: 0, right: 8 }}>
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    tickLine={false}
                    axisLine={false}
                    width={120}
                    fontSize={12}
                    tick={{ style: { whiteSpace: "nowrap" } }}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="count" fill="var(--chart-1)" radius={3} barSize={16} />
                </BarChart>
              </ChartContainer>
            ) : (
              <div className="flex h-[60px] items-center justify-center text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>

        {/* Model Usage Bar Chart */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Model Usage</CardTitle>
          </CardHeader>
          <CardContent className="pb-4">
            {modelBarData.length > 0 ? (
              <div className="max-h-[150px] overflow-y-auto">
                <ChartContainer
                  config={{ count: { label: "Logs", color: "var(--chart-2)" } }}
                  className="w-full"
                  style={{ height: `${Math.max(60, modelBarData.length * 28)}px` }}
                >
                  <BarChart data={modelBarData} layout="vertical" margin={{ left: 0, right: 8 }}>
                    <XAxis type="number" hide />
                    <YAxis
                      type="category"
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      width={130}
                      fontSize={12}
                      tick={{ style: { whiteSpace: "nowrap" } }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="count" fill="var(--chart-2)" radius={3} barSize={16} />
                  </BarChart>
                </ChartContainer>
              </div>
            ) : (
              <div className="flex h-[60px] items-center justify-center text-sm text-muted-foreground">No data</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Team Members Table - no card wrapper like admin */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Team Members</h2>
          {isOwner && <AddMemberPopover teamId={team.id} onSuccess={refresh} />}
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[250px]">Member</TableHead>
                <TableHead>Logs</TableHead>
                <TableHead>Changes</TableHead>
                <TableHead>Top Model</TableHead>
                <TableHead>Top Agent</TableHead>
                {isOwner && <TableHead className="w-[50px]" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {memberStats.map((member) => {
                const AgentIcon = getAgentIcon(member.favoriteAgent);
                return (
                  <TableRow key={member.userId}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <Avatar className="size-8">
                          <AvatarImage src={member.userImage ?? undefined} alt={member.userName ?? ""} />
                          <AvatarFallback className="text-xs">{member.userName?.charAt(0) ?? "?"}</AvatarFallback>
                        </Avatar>
                        <div className="flex flex-col">
                          <span className="flex items-center gap-2 font-medium">
                            {member.userName}
                            {member.isOwner && (
                              <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                                Owner
                              </Badge>
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">{member.userEmail}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono">{member.transcriptCount}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {member.linesAdded > 0 || member.linesModified > 0 || member.linesRemoved > 0 ? (
                        <>
                          <span className="text-green-500">+{member.linesAdded}</span>
                          <span className="mx-0.5 text-yellow-500">~{member.linesModified}</span>
                          <span className="text-red-500">-{member.linesRemoved}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {member.favoriteModel ? getModelDisplayName(member.favoriteModel) : "—"}
                    </TableCell>
                    <TableCell>
                      {member.favoriteAgent ? (
                        <span className="flex items-center gap-1.5 text-sm">
                          {AgentIcon && <AgentIcon className="h-3.5 w-3.5 text-muted-foreground" />}
                          {getAgentDisplayName(member.favoriteAgent)}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    {isOwner && (
                      <TableCell>
                        {!member.isOwner && (
                          <RemoveMemberButton
                            teamId={team.id}
                            userId={member.userId}
                            userName={member.userName ?? ""}
                            onRemoved={refresh}
                          />
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}

function RemoveMemberButton({
  teamId,
  userId,
  userName,
  onRemoved,
}: {
  teamId: string;
  userId: string;
  userName: string;
  onRemoved: () => void;
}) {
  const [isRemoving, setIsRemoving] = useState(false);

  const handleRemove = async () => {
    if (!confirm(`Remove ${userName} from the team?`)) return;
    setIsRemoving(true);
    try {
      await removeMember({ data: { teamId, targetUserId: userId } });
      onRemoved();
    } finally {
      setIsRemoving(false);
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-7 text-xs text-muted-foreground hover:text-destructive"
      onClick={handleRemove}
      disabled={isRemoving}
    >
      {isRemoving ? "..." : "Remove"}
    </Button>
  );
}

function AddMemberPopover({ teamId, onSuccess }: { teamId: string; onSuccess: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"email" | "link">("email");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isAddingEmail, setIsAddingEmail] = useState(false);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleAddByEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setIsAddingEmail(true);
    setEmailError(null);
    try {
      await addMemberByEmail({ data: { teamId, email } });
      setEmail("");
      onSuccess();
      setIsOpen(false);
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : "Failed to add member");
    } finally {
      setIsAddingEmail(false);
    }
  };

  const handleGenerateLink = async () => {
    setIsGenerating(true);
    try {
      const data = await generateInvite({ data: teamId });
      setInviteUrl(`${window.location.origin}${data.url}`);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyLink = () => {
    if (inviteUrl) {
      navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" className="h-8 gap-1.5">
          <UserPlus className="h-3.5 w-3.5" />
          Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab("email")}
            className={`flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm transition-colors ${activeTab === "email" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Mail className="h-4 w-4" />
            Email
          </button>
          <button
            onClick={() => setActiveTab("link")}
            className={`flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm transition-colors ${activeTab === "link" ? "border-b-2 border-primary text-foreground" : "text-muted-foreground hover:text-foreground"}`}
          >
            <Link className="h-4 w-4" />
            Invite Link
          </button>
        </div>
        <div className="p-4">
          {activeTab === "email" ? (
            <form onSubmit={handleAddByEmail} className="space-y-3">
              <p className="text-sm text-muted-foreground">Add an existing user by their email address.</p>
              <div className="flex gap-2">
                <Input
                  type="email"
                  placeholder="colleague@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError(null);
                  }}
                  className="h-9 flex-1"
                />
                <Button type="submit" size="sm" className="h-9" disabled={isAddingEmail || !email.trim()}>
                  {isAddingEmail ? "..." : "Add"}
                </Button>
              </div>
              {emailError && <p className="text-xs text-destructive">{emailError}</p>}
            </form>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Share this link to invite someone to join your team.</p>
              {inviteUrl ? (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Input value={inviteUrl} readOnly className="h-9 flex-1 font-mono text-xs" />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 w-9 shrink-0 p-0"
                      onClick={handleCopyLink}
                    >
                      {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                    </Button>
                  </div>
                  <button
                    onClick={handleGenerateLink}
                    disabled={isGenerating}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Generate new link
                  </button>
                </div>
              ) : (
                <Button onClick={handleGenerateLink} disabled={isGenerating} size="sm" className="h-9 w-full">
                  {isGenerating ? "Generating..." : "Generate Link"}
                </Button>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function NoTeamView({ onSuccess }: { onSuccess: () => void }) {
  const [teamName, setTeamName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      await createTeam({ data: { name: teamName } });
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create team");
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">No Team Yet</h1>
        <p className="text-sm text-muted-foreground">Create a team to share transcripts with colleagues.</p>
        <form onSubmit={handleCreateTeam} className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={teamName}
              onChange={(e) => {
                setTeamName(e.target.value);
                setError(null);
              }}
              placeholder="Acme Engineering"
              autoFocus
            />
            <Button type="submit" disabled={isCreating || !teamName.trim()}>
              {isCreating ? "Creating..." : "Create"}
            </Button>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
        </form>
      </div>
    </div>
  );
}
