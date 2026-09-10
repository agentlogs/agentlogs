import { spawn, type ChildProcess } from "node:child_process";
import type { CliCommand } from "./hooks";

export const HOOK_TIMEOUT_MS = 60_000;

export interface HookPayload {
  hook_event_name: string;
  session_id: string;
  call_id?: string;
  tool?: string;
  cwd?: string;
  tool_input?: Record<string, unknown>;
  tool_output?: Record<string, unknown>;
}

export interface HookResponse {
  modified: boolean;
  args?: Record<string, unknown>;
}

async function killProcessTree(proc: ChildProcess): Promise<void> {
  if (!proc.pid) return;
  if (process.platform === "win32") {
    await new Promise<void>((resolve, reject) => {
      const killer = spawn("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" });
      killer.on("error", reject);
      killer.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`taskkill exited ${code}`))));
    });
    return;
  }
  try {
    // A detached child leads its own process group, including npx and export
    // descendants. Killing only npx can leave those descendants holding locks.
    process.kill(-proc.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

export async function runHook(
  cli: CliCommand,
  payload: HookPayload,
  cwd: string,
  options: { timeoutMs?: number; log?: (message: string, data?: unknown) => void } = {},
): Promise<HookResponse> {
  const log = options.log ?? (() => {});
  const args = [...cli.args, "opencode", "hook"];
  log("Running hook", { command: cli.command, args, payload: payload.hook_event_name });

  return new Promise((resolve) => {
    const proc = spawn(cli.command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let cleanup: Promise<void> | undefined;
    const timeout = setTimeout(() => {
      timedOut = true;
      log("Hook timed out", { event: payload.hook_event_name });
      cleanup = killProcessTree(proc).catch((error) => {
        log("Hook cleanup error", { error: String(error) });
      });
    }, options.timeoutMs ?? HOOK_TIMEOUT_MS);

    proc.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    proc.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    proc.stdin.on("error", (error) => log("Hook stdin error", { error: String(error) }));
    proc.on("error", (error) => {
      log("Hook spawn error", { error: String(error) });
      // A failed spawn also emits close; settle there so the queue never runs
      // ahead of a child that is still exiting.
    });
    proc.on("close", async (code) => {
      clearTimeout(timeout);
      await cleanup;
      log("Hook process exited", { code, stdout: stdout.slice(0, 500), stderr: stderr.slice(0, 500) });
      if (!timedOut && code === 0 && stdout.trim()) {
        try {
          resolve(JSON.parse(stdout.trim()) as HookResponse);
          return;
        } catch {
          // Malformed responses must not prevent the original tool from running.
        }
      }
      resolve({ modified: false });
    });
    proc.stdin.end(JSON.stringify(payload));
  });
}
