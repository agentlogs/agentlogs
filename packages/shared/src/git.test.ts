import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  getRepoIdFromGitRoot,
  getRepoIdsFromGitRoot,
  parseGitRemoteUrl,
  readGitRemotes,
  readGitRemoteUrl,
} from "./git";

function makeRepo(config: string): string {
  const root = mkdtempSync(join(tmpdir(), "agentlogs-git-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "config"), config, "utf8");
  return root;
}

const ORIGIN_ONLY = `[core]
\trepositoryformatversion = 0
[remote "origin"]
\turl = git@github.com:owner/repo.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
\tremote = origin
`;

const FORK_WITH_UPSTREAM = `[remote "origin"]
\turl = git@github.com:me/repo-fork.git
\tfetch = +refs/heads/*:refs/remotes/origin/*
[remote "upstream"]
\turl = https://github.com/acme/repo.git
\tfetch = +refs/heads/*:refs/remotes/upstream/*
`;

describe("parseGitRemoteUrl", () => {
  it("parses SSH remotes", () => {
    expect(parseGitRemoteUrl("git@github.com:owner/repo.git")).toBe("github.com/owner/repo");
  });

  it("parses HTTPS remotes with and without .git", () => {
    expect(parseGitRemoteUrl("https://github.com/owner/repo.git")).toBe("github.com/owner/repo");
    expect(parseGitRemoteUrl("https://github.com/owner/repo")).toBe("github.com/owner/repo");
  });

  it("returns null for unparseable input", () => {
    expect(parseGitRemoteUrl("not-a-remote")).toBeNull();
  });
});

describe("readGitRemotes", () => {
  it("reads a single origin remote", async () => {
    const root = makeRepo(ORIGIN_ONLY);
    expect(await readGitRemotes(root)).toEqual([{ name: "origin", url: "git@github.com:owner/repo.git" }]);
  });

  it("reads multiple remotes with origin first", async () => {
    const root = makeRepo(FORK_WITH_UPSTREAM);
    const remotes = await readGitRemotes(root);
    expect(remotes.map((r) => r.name)).toEqual(["origin", "upstream"]);
    expect(remotes[1]?.url).toBe("https://github.com/acme/repo.git");
  });

  it("returns origin first even when it is declared after another remote", async () => {
    const root = makeRepo(`[remote "upstream"]
\turl = https://github.com/acme/repo.git
[remote "origin"]
\turl = git@github.com:me/repo-fork.git
`);
    expect((await readGitRemotes(root)).map((r) => r.name)).toEqual(["origin", "upstream"]);
  });

  it("returns an empty list when there are no remotes", async () => {
    const root = makeRepo(`[core]\n\trepositoryformatversion = 0\n`);
    expect(await readGitRemotes(root)).toEqual([]);
  });

  it("returns an empty list when .git/config is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentlogs-git-empty-"));
    expect(await readGitRemotes(root)).toEqual([]);
  });
});

describe("readGitRemoteUrl (origin-only, backward compatible)", () => {
  it("returns the origin url", async () => {
    const root = makeRepo(FORK_WITH_UPSTREAM);
    expect(await readGitRemoteUrl(root)).toBe("git@github.com:me/repo-fork.git");
  });

  it("returns null when there is no origin remote (no silent fallback to another remote)", async () => {
    const root = makeRepo(`[remote "upstream"]\n\turl = https://github.com/acme/repo.git\n`);
    expect(await readGitRemoteUrl(root)).toBeNull();
  });
});

describe("getRepoIdFromGitRoot (origin)", () => {
  it("resolves the origin repo id", async () => {
    const root = makeRepo(ORIGIN_ONLY);
    expect(await getRepoIdFromGitRoot(root)).toBe("github.com/owner/repo");
  });
});

describe("getRepoIdsFromGitRoot (all remotes)", () => {
  it("resolves a single origin repo id", async () => {
    const root = makeRepo(ORIGIN_ONLY);
    expect(await getRepoIdsFromGitRoot(root)).toEqual([{ repoId: "github.com/owner/repo", remote: "origin" }]);
  });

  it("resolves fork origin and canonical upstream, origin first", async () => {
    const root = makeRepo(FORK_WITH_UPSTREAM);
    expect(await getRepoIdsFromGitRoot(root)).toEqual([
      { repoId: "github.com/me/repo-fork", remote: "origin" },
      { repoId: "github.com/acme/repo", remote: "upstream" },
    ]);
  });

  it("de-duplicates remotes pointing at the same repo", async () => {
    const root = makeRepo(`[remote "origin"]
\turl = git@github.com:acme/repo.git
[remote "mirror"]
\turl = https://github.com/acme/repo.git
`);
    expect(await getRepoIdsFromGitRoot(root)).toEqual([{ repoId: "github.com/acme/repo", remote: "origin" }]);
  });
});
