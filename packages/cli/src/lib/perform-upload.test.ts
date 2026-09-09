import { describe, expect, it } from "bun:test";
import type { UnifiedTranscript } from "@agentlogs/shared/claudecode";
import { extractCwdCandidatesFromRecords, skipMessageLines, stampResolvedRepoId } from "./perform-upload";

function transcriptWithGit(repo: string | null): UnifiedTranscript {
  // Only the git field is relevant here; cast through unknown to avoid building a
  // full UnifiedTranscript for a pure-field test.
  return {
    git: repo === null ? null : { relativeCwd: ".", branch: "main", repo },
  } as unknown as UnifiedTranscript;
}

describe("stampResolvedRepoId", () => {
  it("overrides the embedded git.repo with the resolved repo (fork origin -> upstream)", () => {
    const t = transcriptWithGit("github.com/me/repo-fork");
    const stamped = stampResolvedRepoId(t, "github.com/acme/repo");
    expect(stamped.git?.repo).toBe("github.com/acme/repo");
    // Other git fields are preserved.
    expect(stamped.git?.branch).toBe("main");
    // Original is not mutated.
    expect(t.git?.repo).toBe("github.com/me/repo-fork");
  });

  it("is a no-op when repoId is null", () => {
    const t = transcriptWithGit("github.com/me/repo-fork");
    expect(stampResolvedRepoId(t, null)).toBe(t);
  });

  it("attributes a resolved repo even when the source omitted git context", () => {
    const t = transcriptWithGit(null);
    expect(stampResolvedRepoId(t, "github.com/acme/repo").git).toEqual({
      relativeCwd: null,
      branch: null,
      repo: "github.com/acme/repo",
    });
  });

  it("is a no-op when the repo already matches", () => {
    const t = transcriptWithGit("github.com/acme/repo");
    expect(stampResolvedRepoId(t, "github.com/acme/repo")).toBe(t);
  });
});

describe("skipMessageLines", () => {
  it("reports the blocking root without claiming every repo is unlisted", () => {
    const text = skipMessageLines(["github.com/allowed/repo", "github.com/private/repo"], {
      reason: "unlisted-root",
      gitRoot: "/private",
    }).join("\n");
    expect(text).toContain("a Git root with no allowlisted remote");
    expect(text).toContain("Blocking Git root: /private");
    expect(text).not.toContain("none of the repos");
  });

  it("distinguishes denied repositories from unresolved roots", () => {
    expect(skipMessageLines([], { reason: "denied-repo", repoId: "github.com/secret/repo" }).join("\n")).toContain(
      "explicitly denied",
    );
    expect(skipMessageLines([], { reason: "unresolved-root", gitRoot: "/private" }).join("\n")).toContain(
      "no readable, supported remote",
    );
  });
  it("lists the repos seen when present", () => {
    const lines = skipMessageLines(["github.com/a/b", "github.com/c/d"]);
    expect(lines.join("\n")).toContain("github.com/a/b, github.com/c/d");
    expect(lines.some((l) => l.includes("agentlogs allow"))).toBe(true);
  });

  it("falls back to a no-repo message when nothing was seen", () => {
    const lines = skipMessageLines([]);
    expect(lines.join("\n")).toContain("no allowlisted git repository");
  });

  it("treats undefined like empty", () => {
    expect(skipMessageLines(undefined)).toEqual(skipMessageLines([]));
  });
});

describe("extractCwdCandidatesFromRecords", () => {
  it("reads Codex session metadata and turn contexts, ignoring unrelated payloads", () => {
    expect(
      extractCwdCandidatesFromRecords(
        [
          { type: "session_meta", payload: { cwd: "/home" } },
          { type: "turn_context", payload: { cwd: "/repo" } },
          { type: "turn_context", payload: { cwd: "/repo/src/.." } },
          { type: "response_item", payload: { cwd: "/ignored" } },
          { type: "turn_context", payload: { cwd: 42 } },
          { type: "turn_context", payload: null },
        ],
        "codex",
      ),
    ).toEqual([
      { cwd: "/repo", weight: 2 },
      { cwd: "/home", weight: 1 },
    ]);
  });
  it("ranks cwds by frequency, ties broken by first appearance", () => {
    const records = [
      { cwd: "/home" },
      { cwd: "/home" },
      { cwd: "/repo" },
      { cwd: "/repo" },
      { cwd: "/repo" },
      { other: 1 },
      { cwd: "  " },
    ];
    expect(extractCwdCandidatesFromRecords(records)).toEqual([
      { cwd: "/repo", weight: 3 },
      { cwd: "/home", weight: 2 },
    ]);
  });

  it("returns an empty list when no record carries a cwd", () => {
    expect(extractCwdCandidatesFromRecords([{ a: 1 }, { b: 2 }])).toEqual([]);
  });
});
