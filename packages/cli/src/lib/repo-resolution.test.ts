import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  buildRepoCandidates,
  createDefaultResolveCwd,
  type CwdResolution,
  resolveUploadTarget,
  selectBestAllowedRepo,
} from "./repo-resolution";

/** Build a stub resolveCwd from a cwd -> CwdResolution map. */
function stubResolve(map: Record<string, CwdResolution | null>) {
  return async (cwd: string) => map[cwd] ?? null;
}

/** Allowlist predicate from an explicit set of allowed repo ids. */
function allowlist(...allowed: string[]) {
  const set = new Set(allowed);
  return (repoId: string | null) => (repoId === null ? false : set.has(repoId));
}

/** Denylist predicate: everything allowed except the explicitly denied set (null allowed). */
function denylist(...denied: string[]) {
  const set = new Set(denied);
  return (repoId: string | null) => (repoId === null ? true : !set.has(repoId));
}

const HOME = "/Users/me";
const CLONE = "/Users/me/Projects/repo";
const FORK = "/Users/me/Projects/repo-fork";

describe("selectBestAllowedRepo", () => {
  it("returns the first allowed candidate in priority order", () => {
    const candidates = [
      { repoId: "github.com/you/fork", cwd: FORK, gitRoot: FORK, remote: "origin", weight: 400 },
      { repoId: "github.com/acme/repo", cwd: FORK, gitRoot: FORK, remote: "upstream", weight: 400 },
    ];
    expect(selectBestAllowedRepo(candidates, (id) => id === "github.com/acme/repo")?.repoId).toBe(
      "github.com/acme/repo",
    );
  });

  it("returns null when no candidate is allowed", () => {
    const candidates = [{ repoId: "github.com/you/fork", cwd: FORK, gitRoot: FORK, remote: "origin", weight: 1 }];
    expect(selectBestAllowedRepo(candidates, () => false)).toBeNull();
  });
});

describe("buildRepoCandidates", () => {
  it("flattens cwds x remotes preserving cwd order and origin-first within a cwd", async () => {
    const resolve = stubResolve({
      [CLONE]: { gitRoot: CLONE, repos: [{ repoId: "github.com/acme/repo", remote: "origin" }] },
      [HOME]: null,
    });
    const candidates = await buildRepoCandidates(
      [
        { cwd: CLONE, weight: 400 },
        { cwd: HOME, weight: 100 },
      ],
      resolve,
    );
    expect(candidates).toEqual([
      { repoId: "github.com/acme/repo", cwd: CLONE, gitRoot: CLONE, remote: "origin", weight: 400 },
    ]);
  });
});

describe("resolveUploadTarget", () => {
  it("home case: selects the allowlisted clone, not the non-repo home dir", async () => {
    const resolve = stubResolve({
      [HOME]: null,
      [CLONE]: { gitRoot: CLONE, repos: [{ repoId: "github.com/acme/repo", remote: "origin" }] },
    });
    const target = await resolveUploadTarget(
      [
        { cwd: CLONE, weight: 400 },
        { cwd: HOME, weight: 100 },
      ],
      HOME,
      { resolveCwd: resolve, isAllowed: allowlist("github.com/acme/repo") },
    );
    expect(target).toEqual({
      repoId: "github.com/acme/repo",
      cwd: CLONE,
      allowed: true,
      candidatesSeen: ["github.com/acme/repo"],
    });
  });

  it("fork case: selects the allowlisted upstream over the unlisted origin fork", async () => {
    const resolve = stubResolve({
      [FORK]: {
        gitRoot: FORK,
        repos: [
          { repoId: "github.com/you/repo-fork", remote: "origin" },
          { repoId: "github.com/acme/repo", remote: "upstream" },
        ],
      },
    });
    const target = await resolveUploadTarget([{ cwd: FORK, weight: 1 }], FORK, {
      resolveCwd: resolve,
      isAllowed: allowlist("github.com/acme/repo"),
    });
    expect(target.allowed).toBe(true);
    expect(target.repoId).toBe("github.com/acme/repo");
    expect(target.cwd).toBe(FORK);
  });

  it("common case: first cwd already an allowed repo resolves to that repo", async () => {
    const resolve = stubResolve({
      [CLONE]: { gitRoot: CLONE, repos: [{ repoId: "github.com/acme/repo", remote: "origin" }] },
    });
    const target = await resolveUploadTarget([{ cwd: CLONE, weight: 10 }], CLONE, {
      resolveCwd: resolve,
      isAllowed: denylist(),
    });
    expect(target).toEqual({
      repoId: "github.com/acme/repo",
      cwd: CLONE,
      allowed: true,
      candidatesSeen: ["github.com/acme/repo"],
    });
  });

  it("denylist + no resolvable repo: uploads as unknown repo (null)", async () => {
    const target = await resolveUploadTarget([{ cwd: HOME, weight: 5 }], HOME, {
      resolveCwd: stubResolve({ [HOME]: null }),
      isAllowed: denylist(),
    });
    expect(target).toEqual({ repoId: null, cwd: HOME, allowed: true, candidatesSeen: [] });
  });

  it("allowlist + no resolvable repo: skipped", async () => {
    const target = await resolveUploadTarget([{ cwd: HOME, weight: 5 }], HOME, {
      resolveCwd: stubResolve({ [HOME]: null }),
      isAllowed: allowlist("github.com/acme/repo"),
    });
    expect(target.allowed).toBe(false);
    expect(target.repoId).toBeNull();
  });

  it("allowlist + repos found but none allowed: skipped with candidates seen", async () => {
    const resolve = stubResolve({
      [FORK]: { gitRoot: FORK, repos: [{ repoId: "github.com/you/repo-fork", remote: "origin" }] },
    });
    const target = await resolveUploadTarget([{ cwd: FORK, weight: 3 }], FORK, {
      resolveCwd: resolve,
      isAllowed: allowlist("github.com/acme/repo"),
    });
    expect(target.allowed).toBe(false);
    expect(target.candidatesSeen).toEqual(["github.com/you/repo-fork"]);
  });

  it("allowlist: a non-allowlisted repo touched alongside an allowed one forces a skip", async () => {
    const PRIVATE = "/Users/me/Projects/private";
    const resolve = stubResolve({
      [CLONE]: { gitRoot: CLONE, repos: [{ repoId: "github.com/acme/repo", remote: "origin" }] },
      [PRIVATE]: { gitRoot: PRIVATE, repos: [{ repoId: "github.com/me/private", remote: "origin" }] },
    });
    const target = await resolveUploadTarget(
      [
        { cwd: CLONE, weight: 400 },
        { cwd: PRIVATE, weight: 5 },
      ],
      CLONE,
      { resolveCwd: resolve, isAllowed: allowlist("github.com/acme/repo") },
    );
    expect(target.allowed).toBe(false);
    expect(target.candidatesSeen).toContain("github.com/me/private");
  });

  it("aggregates cwd weights by git root, not by hottest single directory", async () => {
    const SRC = "/Users/me/Projects/repo/src";
    const TESTS = "/Users/me/Projects/repo/tests";
    const OTHER2 = "/Users/me/Projects/other";
    const resolve = stubResolve({
      [SRC]: { gitRoot: "/Users/me/Projects/repo", repos: [{ repoId: "github.com/acme/repo", remote: "origin" }] },
      [TESTS]: { gitRoot: "/Users/me/Projects/repo", repos: [{ repoId: "github.com/acme/repo", remote: "origin" }] },
      [OTHER2]: { gitRoot: OTHER2, repos: [{ repoId: "github.com/acme/other", remote: "origin" }] },
    });
    const target = await resolveUploadTarget(
      [
        { cwd: OTHER2, weight: 3 },
        { cwd: SRC, weight: 2 },
        { cwd: TESTS, weight: 2 },
      ],
      OTHER2,
      { resolveCwd: resolve, isAllowed: allowlist("github.com/acme/repo", "github.com/acme/other") },
    );
    // repo (2 + 2 = 4) outranks other (3) despite other being the hottest single dir.
    expect(target.repoId).toBe("github.com/acme/repo");
  });

  it("dominant tie-break: higher-weight allowed cwd wins", async () => {
    const OTHER = "/Users/me/Projects/other";
    const resolve = stubResolve({
      [CLONE]: { gitRoot: CLONE, repos: [{ repoId: "github.com/acme/repo", remote: "origin" }] },
      [OTHER]: { gitRoot: OTHER, repos: [{ repoId: "github.com/acme/other", remote: "origin" }] },
    });
    const target = await resolveUploadTarget(
      [
        { cwd: CLONE, weight: 400 },
        { cwd: OTHER, weight: 50 },
      ],
      CLONE,
      { resolveCwd: resolve, isAllowed: allowlist("github.com/acme/repo", "github.com/acme/other") },
    );
    expect(target.repoId).toBe("github.com/acme/repo");
  });

  it("denylist + explicitly denied repo found: skipped (respects the deny)", async () => {
    const resolve = stubResolve({
      [CLONE]: { gitRoot: CLONE, repos: [{ repoId: "github.com/acme/secret", remote: "origin" }] },
    });
    const target = await resolveUploadTarget([{ cwd: CLONE, weight: 9 }], CLONE, {
      resolveCwd: resolve,
      isAllowed: denylist("github.com/acme/secret"),
    });
    expect(target.allowed).toBe(false);
    expect(target.repoId).toBe("github.com/acme/secret");
  });

  it("denylist deny-wins: a denied repo touched alongside an allowed repo forces a skip", async () => {
    const DENIED = "/Users/me/Projects/secret";
    const resolve = stubResolve({
      [CLONE]: { gitRoot: CLONE, repos: [{ repoId: "github.com/acme/repo", remote: "origin" }] },
      [DENIED]: { gitRoot: DENIED, repos: [{ repoId: "github.com/acme/secret", remote: "origin" }] },
    });
    // CLONE is the dominant (allowed) repo, but the session also touched a denied repo.
    const target = await resolveUploadTarget(
      [
        { cwd: CLONE, weight: 500 },
        { cwd: DENIED, weight: 5 },
      ],
      CLONE,
      { resolveCwd: resolve, isAllowed: denylist("github.com/acme/secret") },
    );
    expect(target.allowed).toBe(false);
    expect(target.candidatesSeen).toContain("github.com/acme/secret");
  });

  it("denylist + only allowed repos: uploads (deny-wins does not over-fire)", async () => {
    const resolve = stubResolve({
      [CLONE]: { gitRoot: CLONE, repos: [{ repoId: "github.com/acme/repo", remote: "origin" }] },
    });
    const target = await resolveUploadTarget([{ cwd: CLONE, weight: 5 }], CLONE, {
      resolveCwd: resolve,
      isAllowed: denylist("github.com/other/denied"),
    });
    expect(target.allowed).toBe(true);
    expect(target.repoId).toBe("github.com/acme/repo");
  });
});

describe("createDefaultResolveCwd (git-root memoization)", () => {
  it("resolves distinct cwds under one repo to the same root, reading config once", async () => {
    const root = mkdtempSync(join(tmpdir(), "agentlogs-resolve-"));
    mkdirSync(join(root, ".git"), { recursive: true });
    writeFileSync(join(root, ".git", "config"), `[remote "origin"]\n\turl = git@github.com:acme/repo.git\n`, "utf8");
    const subA = join(root, "src");
    const subB = join(root, "src", "lib");
    mkdirSync(subB, { recursive: true });

    const resolve = createDefaultResolveCwd();
    const a = await resolve(subA);
    expect(a?.repos).toEqual([{ repoId: "github.com/acme/repo", remote: "origin" }]);

    // Remove the config; a memoized resolver keyed by git root must still return
    // the cached repos for another cwd under the same root (proving no re-read).
    rmSync(join(root, ".git", "config"));
    const b = await resolve(subB);
    expect(b?.gitRoot).toBe(a?.gitRoot);
    expect(b?.repos).toEqual([{ repoId: "github.com/acme/repo", remote: "origin" }]);
  });
});
