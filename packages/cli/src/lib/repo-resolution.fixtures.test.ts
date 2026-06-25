import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { resolve } from "path";
import { extractCwdCandidatesFromRecords } from "./perform-upload";
import { type CwdResolution, resolveUploadTarget } from "./repo-resolution";

const FIXTURES = resolve(import.meta.dir, "../../../../fixtures/repo-resolution");

function loadRecords(name: string): Record<string, unknown>[] {
  const raw = readFileSync(resolve(FIXTURES, name), "utf8");
  return raw
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

function stubResolve(map: Record<string, CwdResolution | null>) {
  return async (cwd: string) => map[cwd] ?? null;
}

function allowlist(...allowed: string[]) {
  const set = new Set(allowed);
  return (repoId: string | null) => (repoId === null ? false : set.has(repoId));
}

describe("repo resolution over real transcript fixtures", () => {
  it("home-then-clone: attributes to the allowlisted clone, not the home dir", async () => {
    const records = loadRecords("home-then-clone.jsonl");
    const candidates = extractCwdCandidatesFromRecords(records);
    // Clone dir worked in 4x vs home 2x -> clone ranks first.
    expect(candidates[0]?.cwd).toBe("/Users/me/Projects/repo");

    const target = await resolveUploadTarget(candidates, "/Users/me", {
      resolveCwd: stubResolve({
        "/Users/me": null,
        "/Users/me/Projects/repo": {
          gitRoot: "/Users/me/Projects/repo",
          repos: [{ repoId: "github.com/acme/repo", remote: "origin" }],
        },
      }),
      isAllowed: allowlist("github.com/acme/repo"),
    });

    expect(target.allowed).toBe(true);
    expect(target.repoId).toBe("github.com/acme/repo");
    expect(target.cwd).toBe("/Users/me/Projects/repo");
  });

  it("fork-upstream: attributes to the allowlisted upstream remote of the fork clone", async () => {
    const records = loadRecords("fork-upstream.jsonl");
    const candidates = extractCwdCandidatesFromRecords(records);

    const target = await resolveUploadTarget(candidates, "/Users/me/Projects/repo-fork", {
      resolveCwd: stubResolve({
        "/Users/me/Projects/repo-fork": {
          gitRoot: "/Users/me/Projects/repo-fork",
          repos: [
            { repoId: "github.com/you/repo-fork", remote: "origin" },
            { repoId: "github.com/acme/repo", remote: "upstream" },
          ],
        },
      }),
      isAllowed: allowlist("github.com/acme/repo"),
    });

    expect(target.allowed).toBe(true);
    expect(target.repoId).toBe("github.com/acme/repo");
  });
});
