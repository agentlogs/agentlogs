#!/usr/bin/env bun

/**
 * Release script for publishable targets
 *
 * Usage:
 *   bun release cli patch          # Release cli with patch bump
 *   bun release cli pi minor       # Release cli and pi with minor bump
 *   bun release opencode major     # Release opencode with major bump
 *   bun release server patch       # Release server artifacts with patch bump
 *   bun release cli patch --dry    # Dry run
 */

const BUMP_TYPES = ["patch", "minor", "major"] as const;
type BumpType = (typeof BUMP_TYPES)[number];

const RELEASE_TARGETS = {
  cli: { path: "packages/cli/package.json" },
  pi: { path: "packages/pi/package.json" },
  opencode: { path: "packages/opencode/package.json" },
  server: { path: "packages/server/package.json" },
} as const satisfies Record<string, { path: string }>;

const SUPPORTED_TARGETS = Object.keys(RELEASE_TARGETS).join(", ");

interface PackageJson {
  name: string;
  version: string;
  private?: boolean;
}

interface ReleaseInfo {
  name: string;
  path: string;
  pkg: PackageJson;
  oldVersion: string;
  newVersion: string;
  tag: string;
}

// Parse arguments
const args = process.argv.slice(2);
const dryRun = args.includes("--dry");
const filteredArgs = args.filter((a) => a !== "--dry");

// Last arg should be bump type
const bumpType = filteredArgs.pop() as BumpType;
const packageNames = filteredArgs;

function printUsage() {
  console.log(`
Usage: bun release <packages...> <patch|minor|major> [--dry]

Examples:
  bun release cli patch          # Release cli with patch bump
  bun release cli pi minor       # Release cli and pi with minor bump
  bun release opencode major     # Release opencode with major bump
  bun release server patch       # Release server artifacts with patch bump
  bun release cli patch --dry    # Dry run, shows what would happen
`);
}

function bumpVersion(version: string, type: BumpType): string {
  const [major, minor, patch] = version.split(".").map(Number);
  switch (type) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
  }
}

async function exec(cmd: string): Promise<string> {
  const proc = Bun.spawn(["sh", "-c", cmd], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed: ${cmd}\n${stderr}`);
  }
  return stdout.trim();
}

async function checkCleanWorkingDirectory(): Promise<void> {
  const status = await exec("git status --porcelain");
  if (status.length > 0) {
    throw new Error("Working directory is not clean. Commit or stash changes first.");
  }
}

async function checkOnMainBranch(): Promise<void> {
  const branch = await exec("git branch --show-current");
  if (branch !== "main") {
    throw new Error(`Not on main branch (currently on "${branch}"). Switch to main first.`);
  }
}

async function validatePackage(name: string): Promise<{ path: string; pkg: PackageJson }> {
  const target = RELEASE_TARGETS[name as keyof typeof RELEASE_TARGETS];
  if (!target) {
    throw new Error(`Unsupported release target "${name}". Supported targets: ${SUPPORTED_TARGETS}`);
  }

  const { path } = target;
  const file = Bun.file(path);

  if (!(await file.exists())) {
    throw new Error(`Package not found: ${path}`);
  }

  const pkg = (await file.json()) as PackageJson;

  if (pkg.private) {
    throw new Error(`Package "${name}" is private, cannot release`);
  }

  if (!pkg.version) {
    throw new Error(`Package "${name}" has no version field`);
  }

  return { path, pkg };
}

async function main() {
  // Validate arguments
  if (packageNames.length === 0 || !bumpType) {
    printUsage();
    process.exit(1);
  }

  if (!BUMP_TYPES.includes(bumpType)) {
    console.error(`✗ Invalid bump type: "${bumpType}". Must be one of: ${BUMP_TYPES.join(", ")}`);
    process.exit(1);
  }

  // Check git state
  try {
    await checkCleanWorkingDirectory();
    console.log("✓ Working directory clean");
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }

  try {
    await checkOnMainBranch();
    console.log("✓ On main branch");
  } catch (e) {
    console.error(`✗ ${(e as Error).message}`);
    process.exit(1);
  }

  // Validate and prepare releases
  const releases: ReleaseInfo[] = [];

  for (const name of packageNames) {
    try {
      const { path, pkg } = await validatePackage(name);
      const oldVersion = pkg.version;
      const newVersion = bumpVersion(oldVersion, bumpType);
      const tag = `${name}-v${newVersion}`;

      releases.push({ name, path, pkg, oldVersion, newVersion, tag });
      console.log(`✓ ${name}: ${oldVersion} → ${newVersion}`);
    } catch (e) {
      console.error(`✗ ${(e as Error).message}`);
      process.exit(1);
    }
  }

  // Dry run - just show what would happen
  if (dryRun) {
    console.log("\nDry run - would execute:");
    console.log(`  commit: "Release ${releases.map((r) => `${r.name} v${r.newVersion}`).join(", ")}"`);
    console.log(`  tags: ${releases.map((r) => r.tag).join(", ")}`);
    return;
  }

  // Update package.json files
  for (const release of releases) {
    release.pkg.version = release.newVersion;
    await Bun.write(release.path, JSON.stringify(release.pkg, null, 2) + "\n");
  }

  // Git operations
  const commitMessage = `Release ${releases.map((r) => `${r.name} v${r.newVersion}`).join(", ")}`;

  try {
    await exec("git add -A");
    await exec(`git commit -m "${commitMessage}"`);
    console.log(`✓ Committed: "${commitMessage}"`);

    for (const release of releases) {
      await exec(`git tag ${release.tag}`);
    }
    console.log(`✓ Tagged: ${releases.map((r) => r.tag).join(", ")}`);

    await exec("git push");
    await exec(`git push origin ${releases.map((r) => r.tag).join(" ")}`);
    console.log("✓ Pushed to origin");
  } catch (e) {
    console.error(`✗ Git operation failed: ${(e as Error).message}`);
    process.exit(1);
  }
}

main();
