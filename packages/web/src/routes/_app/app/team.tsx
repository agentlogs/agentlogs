import { createFileRoute, useRouter } from "@tanstack/react-router";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, Copy, Link, Mail, MoreHorizontal, Trash2, UserMinus, UserPlus } from "lucide-react";
import { useState } from "react";
import {
  addMemberByEmail,
  createTeam,
  deleteTeam,
  generateInvite,
  getSession,
  getTeam,
  leaveTeam,
  removeMember,
} from "../../../lib/server-functions";

export const Route = createFileRoute("/_app/app/team")({
  loader: async () => {
    const [team, session] = await Promise.all([getTeam(), getSession()]);
    return { team, session };
  },
  component: TeamPage,
});

function TeamPage() {
  const { team, session } = Route.useLoaderData();
  const router = useRouter();

  const refresh = () => router.invalidate();

  const [isDeleting, setIsDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);

  const handleDeleteTeam = async () => {
    if (!team || !confirm("Are you sure you want to delete this team? All members will be removed.")) return;
    setIsDeleting(true);
    try {
      await deleteTeam({ data: team.id });
      refresh();
    } finally {
      setIsDeleting(false);
    }
  };

  const handleLeaveTeam = async () => {
    if (!team || !confirm("Are you sure you want to leave this team?")) return;
    setIsLeaving(true);
    try {
      await leaveTeam({ data: team.id });
      refresh();
    } finally {
      setIsLeaving(false);
    }
  };

  if (!team) {
    return <NoTeamView onSuccess={refresh} />;
  }

  const isOwner = session?.user?.id === team.ownerId;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">
            {team.name} <span className="font-normal text-muted-foreground">team</span>
          </h1>
          <p className="text-sm text-muted-foreground">
            {team.members.length} member{team.members.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isOwner && <AddMemberPopover teamId={team.id} onSuccess={refresh} />}
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

      {/* Members List */}
      <MembersList team={team} isOwner={isOwner} onMemberRemoved={refresh} />
    </div>
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
        <p className="text-sm text-muted-foreground">
          Create a team to share transcripts with colleagues. Team members can see each other's team-shared transcripts.
        </p>
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

type TeamData = NonNullable<Awaited<ReturnType<typeof getTeam>>>;

function AddMemberPopover({ teamId, onSuccess }: { teamId: string; onSuccess: () => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"email" | "link">("email");

  // Email state
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState<string | null>(null);
  const [isAddingEmail, setIsAddingEmail] = useState(false);

  // Link state
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
      const baseUrl = window.location.origin;
      setInviteUrl(`${baseUrl}${data.url}`);
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
        {/* Tabs */}
        <div className="flex border-b border-border">
          <button
            onClick={() => setActiveTab("email")}
            className={`flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm transition-colors ${
              activeTab === "email"
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Mail className="h-4 w-4" />
            Email
          </button>
          <button
            onClick={() => setActiveTab("link")}
            className={`flex flex-1 items-center justify-center gap-2 px-4 py-2.5 text-sm transition-colors ${
              activeTab === "link"
                ? "border-b-2 border-primary text-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Link className="h-4 w-4" />
            Invite Link
          </button>
        </div>

        {/* Content */}
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

function MembersList({
  team,
  isOwner,
  onMemberRemoved,
}: {
  team: TeamData;
  isOwner: boolean;
  onMemberRemoved: () => void;
}) {
  const [removingId, setRemovingId] = useState<string | null>(null);

  const handleRemoveMember = async (targetUserId: string, memberName: string) => {
    if (!confirm(`Remove ${memberName} from the team?`)) return;

    setRemovingId(targetUserId);
    try {
      await removeMember({ data: { teamId: team.id, targetUserId } });
      onMemberRemoved();
    } finally {
      setRemovingId(null);
    }
  };

  return (
    <div className="space-y-3">
      <div className="divide-y divide-border rounded-lg border border-border">
        {team.members.map((member) => {
          const isMemberOwner = member.userId === team.ownerId;
          return (
            <div key={member.id} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <Avatar className="h-8 w-8">
                  <AvatarImage src={member.user.image ?? undefined} alt={member.user.name} />
                  <AvatarFallback className="text-xs">{member.user.name?.charAt(0) ?? "?"}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{member.user.name}</span>
                    {isMemberOwner && (
                      <Badge variant="secondary" className="px-1.5 py-0 text-[10px]">
                        Owner
                      </Badge>
                    )}
                  </div>
                  <span className="text-xs text-muted-foreground">{member.user.email}</span>
                </div>
              </div>

              {isOwner && !isMemberOwner && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-destructive"
                  onClick={() => handleRemoveMember(member.userId, member.user.name)}
                  disabled={removingId === member.userId}
                >
                  {removingId === member.userId ? "..." : "Remove"}
                </Button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
