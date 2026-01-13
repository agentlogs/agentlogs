import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { createFileRoute, Link } from "@tanstack/react-router";
import { getTranscriptsByCwd } from "../../../lib/server-functions";

type PrivateTranscripts = Awaited<ReturnType<typeof getTranscriptsByCwd>>;

export const Route = createFileRoute("/_app/app/private/$cwd")({
  loader: ({ params }) => getTranscriptsByCwd({ data: params.cwd }),
  component: PrivateDetailComponent,
});

function PrivateDetailComponent() {
  const transcripts = Route.useLoaderData() as PrivateTranscripts;
  const { cwd } = Route.useParams();
  const formatSource = (source: PrivateTranscripts[number]["source"]) => {
    switch (source) {
      case "claude-code":
        return "Claude Code";
      case "codex":
        return "Codex";
      default:
        return "Unknown";
    }
  };

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/app">← Back to Dashboard</Link>
        </Button>
        <h2 className="text-2xl font-bold tracking-tight">Private Transcripts: {decodeURIComponent(cwd)}</h2>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Author</TableHead>
                <TableHead>Transcript ID</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Preview</TableHead>
                <TableHead>Messages</TableHead>
                <TableHead>Cost</TableHead>
                <TableHead>Conversation Date</TableHead>
                <TableHead>Last Updated</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {transcripts.map((transcript) => (
                <TableRow key={transcript.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={transcript.userImage || undefined} alt={transcript.userName || "User"} />
                        <AvatarFallback>
                          {transcript.userName
                            ? transcript.userName
                                .split(" ")
                                .map((n) => n[0])
                                .join("")
                                .toUpperCase()
                                .slice(0, 2)
                            : "U"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-sm">{transcript.userName || "Unknown"}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <code className="font-mono text-sm">{transcript.transcriptId?.slice(0, 8) || "N/A"}...</code>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">{formatSource(transcript.source)}</Badge>
                  </TableCell>
                  <TableCell className="max-w-md truncate text-muted-foreground">
                    {transcript.preview || "No preview"}
                  </TableCell>
                  <TableCell>{transcript.messageCount ?? "N/A"}</TableCell>
                  <TableCell>${transcript.costUsd?.toFixed(4) ?? "0.0000"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(transcript.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {new Date(transcript.updatedAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" asChild>
                      <Link to="/app/logs/$id" params={{ id: transcript.id }}>
                        View
                      </Link>
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
