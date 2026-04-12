import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { get, merge } from "aywson";

const CONFIG_DIR = join(homedir(), ".config", "agentlogs");
const SETTINGS_FILE = join(CONFIG_DIR, "settings.json");

export type AllowMode = "denylist" | "allowlist";
export type Visibility = "private" | "team" | "public";

export interface RepoSettings {
  allow: boolean;
  visibility?: Visibility;
  /** Override for adding transcript link to commit messages (per-repo) */
  addTranscriptLinkToCommit?: boolean;
}

export interface Settings {
  allowMode: AllowMode;
  repos: Record<string, RepoSettings>;
  /** Global default for adding transcript link to commit messages */
  addTranscriptLinkToCommit?: boolean;
}

const DEFAULT_SETTINGS: Settings = {
  allowMode: "denylist",
  repos: {},
};

/**
 * Ensure the config directory exists
 */
function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * Read the settings file (supports JSONC via aywson)
 */
export function readSettings(): Settings {
  ensureConfigDir();

  if (!existsSync(SETTINGS_FILE)) {
    return { ...DEFAULT_SETTINGS };
  }

  try {
    const content = readFileSync(SETTINGS_FILE, "utf-8");
    const parsed = get(content, []) as Partial<Settings>;
    return {
      allowMode: parsed.allowMode === "allowlist" ? "allowlist" : "denylist",
      repos: typeof parsed.repos === "object" && parsed.repos !== null ? parsed.repos : {},
      addTranscriptLinkToCommit: parsed.addTranscriptLinkToCommit,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

/**
 * Write to the settings file (preserves comments via aywson)
 */
export function writeSettings(settings: Settings): void {
  ensureConfigDir();

  try {
    // If file exists, use merge to preserve comments; otherwise create new
    if (existsSync(SETTINGS_FILE)) {
      const content = readFileSync(SETTINGS_FILE, "utf-8");
      const updated = merge(content, settings as unknown as Record<string, unknown>);
      writeFileSync(SETTINGS_FILE, updated, "utf-8");
    } else {
      writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
    }
  } catch (error) {
    console.error("Failed to write settings file:", error);
    throw error;
  }
}

/**
 * Get the repo ID from a working directory by reading .git/config
 * Format: github.com/owner/repo
 * Re-exported from @agentlogs/shared/git
 */
export { getRepoId as getRepoIdFromCwd } from "@agentlogs/shared/git";

/**
 * Check if a repo is allowed for capture based on settings
 */
export function isRepoAllowed(repoId: string | null): boolean {
  if (!repoId) {
    // If we can't determine the repo, use the default behavior
    // In denylist mode, capture. In allowlist mode, don't capture.
    const settings = readSettings();
    return settings.allowMode === "denylist";
  }

  const settings = readSettings();
  const repoSettings = settings.repos[repoId];

  if (settings.allowMode === "denylist") {
    // Capture all repos except explicitly denied
    if (!repoSettings) {
      return true;
    }
    return repoSettings.allow;
  } else {
    // allowlist mode: capture nothing except explicitly allowed
    if (!repoSettings) {
      return false;
    }
    return repoSettings.allow;
  }
}

/**
 * Get the visibility setting for a repo
 * Returns undefined if not set (let server decide)
 */
export function getRepoVisibility(repoId: string | null): Visibility | undefined {
  if (!repoId) {
    return undefined;
  }

  const settings = readSettings();
  const repoSettings = settings.repos[repoId];
  return repoSettings?.visibility;
}

/**
 * Check if transcript link should be added to commit messages.
 * Priority: per-repo > global > default(true)
 */
export function shouldAddTranscriptLinkToCommit(repoId: string | null): boolean {
  const settings = readSettings();

  if (repoId) {
    const repoSettings = settings.repos[repoId];
    if (repoSettings?.addTranscriptLinkToCommit !== undefined) {
      return repoSettings.addTranscriptLinkToCommit;
    }
  }

  if (settings.addTranscriptLinkToCommit !== undefined) {
    return settings.addTranscriptLinkToCommit;
  }

  return true;
}

/**
 * Allow capture for a repo with optional visibility
 */
export function allowRepo(repoId: string, visibility?: Visibility): void {
  const settings = readSettings();

  settings.repos[repoId] = {
    allow: true,
    ...(visibility && { visibility }),
  };

  writeSettings(settings);
}

/**
 * Deny capture for a repo
 */
export function denyRepo(repoId: string): void {
  const settings = readSettings();

  settings.repos[repoId] = {
    allow: false,
  };

  writeSettings(settings);
}

/**
 * Set the allow mode (allowlist or denylist)
 */
export function setAllowMode(mode: AllowMode): void {
  const settings = readSettings();
  settings.allowMode = mode;
  writeSettings(settings);
}

/**
 * Get the settings file path (for display purposes)
 */
export function getSettingsPath(): string {
  return SETTINGS_FILE;
}
