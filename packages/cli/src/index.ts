#!/usr/bin/env node
import { Command } from "commander";
import { allowCommand } from "./commands/allow";
import { denyCommand } from "./commands/deny";
import { loginCommand } from "./commands/login";
import { logoutCommand } from "./commands/logout";
import { settingsCommand } from "./commands/settings";
import { statusCommand } from "./commands/status";
// Interactive upload command
import { interactiveUploadCommand } from "./commands/upload";
// Claude Code commands
import { hookCommand as claudeCodeHookCommand } from "./commands/claudecode/hook";
import { syncCommand } from "./commands/claudecode/sync";
import { claudeCodeUploadCommand } from "./commands/claudecode/upload";
// Cline commands
import { clineHookCommand } from "./commands/cline/hook";
import { clineInstallCommand } from "./commands/cline/install";
import { clineUploadCommand } from "./commands/cline/upload";
// Codex commands
import { codexUploadCommand } from "./commands/codex/upload";
// OpenCode commands
import { opencodeUploadCommand } from "./commands/opencode/upload";
import { hookCommand as openCodeHookCommand } from "./commands/opencode/hook";
// Pi commands
import { piUploadCommand } from "./commands/pi/upload";
import { piHookCommand } from "./commands/pi/hook";
// Service and MCP commands
import { startService, stopService, serviceStatus, serviceLogs } from "./commands/service";
import { mcpCommand } from "./commands/mcp";

const program = new Command();

program
  .name("agentlogs")
  .description("CLI tools for working with AgentLogs accounts and transcripts from AI coding agents");

program
  .command("login")
  .description("Authenticate with AgentLogs using device authorization")
  .argument("<hostname>", "AgentLogs server hostname, e.g. agentlogs.ai")
  .option("--token <token>", "OAuth access token for direct authentication (skips browser)")
  .action(async (hostname: string, options: { token?: string }) => {
    await loginCommand({ hostname, token: options.token });
  });

program
  .command("status")
  .description("Check your current login status")
  .action(async () => {
    await statusCommand();
  });

program
  .command("logout")
  .description("Log out and clear stored credentials")
  .argument("[hostname]", "Optional hostname to log out from (logs out all when omitted)")
  .action(async (hostname?: string) => {
    await logoutCommand({ hostname });
  });

program
  .command("upload")
  .argument("[directory]", "Filter transcripts to this directory")
  .option("-s, --source <source>", "Filter by source: claude-code, cline, codex, opencode, or pi")
  .option("-l, --latest", "Upload the most recent transcript without picker")
  .description("Interactively select and upload a transcript")
  .action(async (directory: string | undefined, options: { source?: string; latest?: boolean }) => {
    const source = options.source as "claude-code" | "codex" | "opencode" | undefined;
    await interactiveUploadCommand(directory, { source, latest: options.latest });
  });

const claudecode = program.command("claudecode").description("Claude Code transcript utilities for AgentLogs");

claudecode
  .command("upload")
  .argument("<transcript>", "Path or alias for a transcript JSONL file")
  .description("Upload a transcript JSONL file to AgentLogs")
  .action(async (transcript: string) => {
    await claudeCodeUploadCommand(transcript);
  });

claudecode
  .command("hook")
  .description("Process Claude Code hook input from stdin")
  .action(async () => {
    await claudeCodeHookCommand();
  });

const codex = program.command("codex").description("Codex transcript utilities for AgentLogs");

codex
  .command("upload")
  .argument("<transcript>", "Path or alias for a Codex transcript JSONL file")
  .description("Upload a Codex transcript JSONL file to AgentLogs")
  .action(async (transcript: string) => {
    await codexUploadCommand(transcript);
  });

const opencode = program.command("opencode").description("OpenCode transcript utilities for AgentLogs");

opencode
  .command("upload")
  .argument("<sessionId>", "OpenCode session ID to upload")
  .description("Upload an OpenCode session transcript to AgentLogs")
  .action(async (sessionId: string) => {
    await opencodeUploadCommand(sessionId);
  });

opencode
  .command("hook")
  .description("Process OpenCode hook input from stdin")
  .action(async () => {
    await openCodeHookCommand();
  });

const cline = program.command("cline").description("Cline transcript utilities for AgentLogs");

cline
  .command("upload")
  .argument("[taskIdOrPath]", "Cline task ID or path to task directory/file")
  .description("Upload a Cline task transcript to AgentLogs")
  .action(async (taskIdOrPath?: string) => {
    await clineUploadCommand(taskIdOrPath);
  });

cline
  .command("hook")
  .description("Process Cline hook input from stdin")
  .action(async () => {
    await clineHookCommand();
  });

cline
  .command("install")
  .description("Install agentlogs hooks into Cline's global hooks directory")
  .action(async () => {
    await clineInstallCommand();
  });

const pi = program.command("pi").description("Pi transcript utilities for AgentLogs");

pi.command("upload")
  .argument("[sessionIdOrPath]", "Pi session ID or path to session file")
  .description("Upload a Pi session transcript to AgentLogs")
  .action(async (sessionIdOrPath?: string) => {
    await piUploadCommand(sessionIdOrPath);
  });

pi.command("hook")
  .description("Process Pi hook input from stdin")
  .action(async () => {
    await piHookCommand();
  });

claudecode
  .command("sync")
  .argument("[claudeDir]", "Optional Claude data directory (defaults to ~/.claude)")
  .option("-r, --repo <repoId>", "Only sync transcripts for the provided repo identifier")
  .description("Upload all local Claude Code transcripts that are missing or outdated on the server")
  .action(async (claudeDir: string | undefined, options: { repo?: string }) => {
    await syncCommand({
      claudeDir,
      repoFilter: options.repo,
    });
  });

program
  .command("settings")
  .description("View and modify AgentLogs settings")
  .option("--allowMode <mode>", "Set allow mode: 'allowlist' or 'denylist'")
  .action(async (options: { allowMode?: string }) => {
    await settingsCommand({ allowMode: options.allowMode });
  });

program
  .command("allow")
  .description("Allow capture for the current repository")
  .option("--visibility <visibility>", "Set visibility: 'public', 'team', or 'private'")
  .option("--public", "Set visibility to public")
  .option("--team", "Set visibility to team")
  .option("--private", "Set visibility to private")
  .action(async (options: { visibility?: string; public?: boolean; team?: boolean; private?: boolean }) => {
    await allowCommand(options);
  });

program
  .command("deny")
  .description("Deny capture for the current repository")
  .action(async () => {
    await denyCommand();
  });

// Service commands
const service = program.command("service").description("Manage the agentlogs background service");

service
  .command("start")
  .description("Start the background service")
  .action(async () => {
    await startService();
  });

service
  .command("stop")
  .description("Stop the background service")
  .action(async () => {
    await stopService();
  });

service
  .command("status")
  .description("Show service status")
  .action(async () => {
    await serviceStatus();
  });

service
  .command("logs")
  .description("Tail the watcher event logs")
  .action(async () => {
    await serviceLogs();
  });

// MCP server command (spawned by Codex)
program
  .command("mcp")
  .description("Start MCP server (used by Codex)")
  .action(async () => {
    await mcpCommand();
  });

program.showHelpAfterError("(add --help for additional information)");

program.parseAsync().catch((error) => {
  console.error("CLI encountered an unexpected error.");
  console.error(error);
  process.exit(1);
});
