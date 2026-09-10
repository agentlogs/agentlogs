import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, existsSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAgentLogsPlugin } from "./plugin";
import { runHook } from "./process";

const cli = { command: process.execPath, args: [join(import.meta.dir, "../fixtures/hook-process.ts")] };
const directories: string[] = [];
function directory() {
  const path = realpathSync(mkdtempSync(join(tmpdir(), "agentlogs-opencode-")));
  directories.push(path);
  return path;
}

afterEach(() => {
  for (const path of directories.splice(0)) {
    const parentFile = join(path, "child.pid.parent");
    if (existsSync(parentFile) && process.platform !== "win32") {
      try {
        process.kill(-Number(readFileSync(parentFile, "utf8")), "SIGKILL");
      } catch {
        // Already reaped by the runner.
      }
    }
    rmSync(path, { recursive: true, force: true });
  }
});

function running(pid: number) {
  try {
    process.kill(pid, 0);
    // A killed orphan can briefly remain a zombie until the init process reaps
    // it on Linux. It cannot execute or hold file descriptors in that state.
    if (process.platform === "linux" && readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1].startsWith("Z")) {
      return false;
    }
    return true;
  } catch (error) {
    if (["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

describe("hook subprocesses", () => {
  it("passes stdin and cwd to a real CLI and reads its response", async () => {
    const cwd = directory();
    const response = await runHook(cli, { hook_event_name: "tool.execute.before", session_id: "ok" }, cwd);
    expect(response).toEqual({ modified: true, args: { command: "updated", cwd } });
  });

  it("fails open for invalid responses, unsuccessful exits, and missing executables", async () => {
    const cwd = directory();
    for (const session_id of ["invalid", "failure"]) {
      expect(await runHook(cli, { hook_event_name: "session.idle", session_id }, cwd)).toEqual({ modified: false });
    }
    expect(
      await runHook(
        { command: join(cwd, "does-not-exist"), args: [] },
        { hook_event_name: "session.idle", session_id: "ok" },
        cwd,
      ),
    ).toEqual({ modified: false });
  });

  it.skipIf(process.platform === "win32")(
    "kills a timed-out process tree before later uploads and commit hooks run",
    async () => {
      const cwd = directory();
      const pidFile = join(cwd, "child.pid");
      const completed: string[] = [];
      let childPid = 0;
      const plugin = await createAgentLogsPlugin({
        run: async (payload, directory) => {
          if (payload.session_id === "hang") payload.tool_input = { pidFile };
          if (completed.length > 0) expect(running(childPid)).toBe(false);
          const response = await runHook(cli, payload, directory, { timeoutMs: 1500 });
          if (payload.session_id === "hang") {
            childPid = Number(readFileSync(pidFile, "utf8"));
            expect(running(childPid)).toBe(false);
            expect(response).toEqual({ modified: false });
          }
          completed.push(payload.hook_event_name);
          return response;
        },
      })({ directory: cwd });

      try {
        await plugin.event({ type: "session.idle", properties: { sessionID: "hang" } });
        await plugin.event({ type: "session.idle", properties: { sessionID: "ok" } });
        await plugin["tool.execute.after"](
          { tool: "bash", sessionID: "ok", callID: "after" },
          { title: "commit", output: "https://agentlogs.ai/s/test", metadata: {} },
        );
        const output = { args: { command: 'git commit -m "Test"' } };
        await plugin["tool.execute.before"]({ tool: "bash", sessionID: "ok", callID: "before" }, output);
        expect(output.args.command).toBe("updated");
        expect(completed).toEqual(["session.idle", "session.idle", "tool.execute.after", "tool.execute.before"]);
      } finally {
        await plugin.dispose();
      }
    },
    10_000,
  );
});
