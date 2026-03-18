import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface CodexPaths {
  codexHome: string;
  configPath: string;
  hooksPath: string;
}

export interface CodexInstallResult {
  paths: CodexPaths;
  configUpdated: boolean;
  hooksUpdated: boolean;
}

interface CodexHooksFile {
  hooks?: Record<string, CodexMatcherGroup[]>;
}

interface CodexMatcherGroup {
  matcher?: string;
  hooks?: CodexHookHandler[];
}

interface CodexHookHandler {
  type: string;
  command: string;
  timeoutSec?: number;
}

const DEFAULT_HOOK_TIMEOUT_SEC = 30;
const DEFAULT_CODEX_HOME = join(homedir(), ".codex");

export function getCodexPaths(): CodexPaths {
  const codexHome = process.env.CODEX_HOME ?? DEFAULT_CODEX_HOME;
  return {
    codexHome,
    configPath: join(codexHome, "config.toml"),
    hooksPath: join(codexHome, "hooks.json"),
  };
}

export function installCodexHookIntegration(hookCommand: string): CodexInstallResult {
  const paths = getCodexPaths();
  ensureCodexHome(paths.codexHome);

  const existingConfig = existsSync(paths.configPath) ? readFileSync(paths.configPath, "utf-8") : "";
  const updatedConfig = updateCodexConfigContents(existingConfig);
  if (updatedConfig !== existingConfig) {
    writeFileSync(paths.configPath, updatedConfig);
  }

  const existingHooks = existsSync(paths.hooksPath) ? readFileSync(paths.hooksPath, "utf-8") : "";
  const nextHooks = updateHooksFileContents(existingHooks, hookCommand);
  if (nextHooks !== existingHooks) {
    writeFileSync(paths.hooksPath, nextHooks);
  }

  return {
    paths,
    configUpdated: updatedConfig !== existingConfig,
    hooksUpdated: nextHooks !== existingHooks,
  };
}

export function updateCodexConfigContents(contents: string): string {
  return upsertKeyInSection(contents, "features", "codex_hooks = true", /^\s*codex_hooks\s*=/);
}

export function updateHooksFileContents(contents: string, hookCommand: string): string {
  const parsed = parseHooksFile(contents);

  const hooks = parsed.hooks ?? {};
  hooks.SessionStart = upsertAgentlogsGroup(hooks.SessionStart ?? [], createAgentlogsGroup(hookCommand));
  hooks.Stop = upsertAgentlogsGroup(hooks.Stop ?? [], createAgentlogsGroup(hookCommand));

  parsed.hooks = hooks;
  return `${JSON.stringify(parsed, null, 2)}\n`;
}

function parseHooksFile(contents: string): CodexHooksFile {
  if (!contents.trim()) {
    return { hooks: {} };
  }

  const parsed = JSON.parse(contents) as CodexHooksFile;
  if (!parsed.hooks || typeof parsed.hooks !== "object") {
    parsed.hooks = {};
  }
  return parsed;
}

function upsertAgentlogsGroup(groups: CodexMatcherGroup[], desired: CodexMatcherGroup): CodexMatcherGroup[] {
  const preserved = groups.filter((group) => !isAgentlogsCodexHookGroup(group));
  return [...preserved, desired];
}

function isAgentlogsCodexHookGroup(group: CodexMatcherGroup): boolean {
  return (group.hooks ?? []).some(
    (hook) => hook.type === "command" && hook.command.includes("agentlogs") && hook.command.includes("codex hook"),
  );
}

function createAgentlogsGroup(command: string): CodexMatcherGroup {
  return {
    hooks: [
      {
        type: "command",
        command,
        timeoutSec: DEFAULT_HOOK_TIMEOUT_SEC,
      },
    ],
  };
}

function ensureCodexHome(codexHome: string): void {
  if (!existsSync(codexHome)) {
    mkdirSync(codexHome, { recursive: true });
  }
}

function upsertKeyInSection(contents: string, sectionName: string, keyLine: string, keyPattern: RegExp): string {
  const lines = splitLines(contents);
  const section = findSection(lines, sectionName);

  if (!section) {
    const nextLines = trimTrailingBlankLines(lines);
    if (nextLines.length > 0) {
      nextLines.push("");
    }
    nextLines.push(`[${sectionName}]`);
    nextLines.push(keyLine);
    return `${nextLines.join("\n")}\n`;
  }

  for (let i = section.start + 1; i < section.end; i++) {
    if (keyPattern.test(lines[i])) {
      lines[i] = keyLine;
      return `${lines.join("\n")}\n`;
    }
  }

  lines.splice(section.start + 1, 0, keyLine);
  return `${lines.join("\n")}\n`;
}

function trimTrailingBlankLines(lines: string[]): string[] {
  const nextLines = [...lines];
  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === "") {
    nextLines.pop();
  }
  return nextLines;
}

function splitLines(contents: string): string[] {
  if (!contents) {
    return [];
  }
  return contents.replace(/\r\n/g, "\n").split("\n");
}

function findSection(lines: string[], sectionName: string): { start: number; end: number } | null {
  const header = `[${sectionName}]`;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== header) {
      continue;
    }

    let end = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*\[[^\]]+\]\s*$/.test(lines[j])) {
        end = j;
        break;
      }
    }

    return { start: i, end };
  }

  return null;
}
