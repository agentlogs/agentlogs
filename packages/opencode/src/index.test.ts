import { describe, expect, it } from "bun:test";
import { createHookQueue, resolveCli, type Clock } from "./lib/hooks";
import { createAgentLogsPlugin } from "./lib/plugin";
import type { HookPayload, HookResponse } from "./lib/process";

async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

function fakeClock() {
  let now = 0;
  let id = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  const clock: Clock = {
    now: () => now,
    setTimeout(callback, delay) {
      timers.set(++id, { at: now + delay, callback });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout(timer) {
      timers.delete(timer as unknown as number);
    },
  };
  return {
    clock,
    timers,
    async advance(ms: number) {
      now += ms;
      for (const [timerId, timer] of timers) {
        if (timer.at > now) continue;
        timers.delete(timerId);
        timer.callback();
      }
      await flush();
    },
  };
}

async function setup() {
  const time = fakeClock();
  const calls: {
    payload: HookPayload;
    cwd: string;
    resolve: (response: HookResponse) => void;
    reject: (error: Error) => void;
  }[] = [];
  const factory = createAgentLogsPlugin({
    clock: time.clock,
    run: (payload, cwd) => new Promise((resolve, reject) => calls.push({ payload, cwd, resolve, reject })),
  });
  const plugin = await factory({ directory: "/project" });
  const idle = (sessionID = "s1") => plugin.event({ event: { type: "session.idle", properties: { sessionID } } });
  const finish = async (index: number, response: HookResponse = { modified: false }) => {
    calls[index].resolve(response);
    await flush();
  };
  return { ...time, calls, factory, plugin, idle, finish };
}

const commitInput = { tool: "bash", sessionID: "s1", callID: "c1" };
const commitOutput = () => ({ args: { command: 'git commit -m "Fix"', description: "Commit the fix" } });
const afterOutput = { title: "commit", output: "[main 1234567] Fix", metadata: {} };

describe("OpenCode plugin callbacks", () => {
  it("coalesces an idle burst before export and expires quiet session state", async () => {
    const h = await setup();
    for (let i = 0; i < 20; i++) void h.idle();
    await flush();
    expect(h.calls).toHaveLength(1);
    await h.finish(0);
    await h.advance(60_000);
    expect(h.calls).toHaveLength(1);
    expect(h.timers.size).toBe(0);
  });

  it("uploads a final turn after the cooldown without another idle event", async () => {
    const h = await setup();
    await h.idle();
    await h.finish(0);
    await h.advance(30_000);
    await h.idle();
    await h.idle();
    await h.advance(29_999);
    expect(h.calls).toHaveLength(1);
    await h.advance(1);
    expect(h.calls).toHaveLength(2);
    await h.finish(1);
    await h.advance(60_000);
    expect(h.calls).toHaveLength(2);
    expect(h.timers.size).toBe(0);
  });

  it("retains an update received while an upload runs beyond the cooldown", async () => {
    const h = await setup();
    await h.idle();
    await h.advance(70_000);
    await h.idle();
    await h.idle();
    expect(h.calls).toHaveLength(1);
    await h.finish(0);
    expect(h.calls).toHaveLength(2);
    await h.finish(1);
  });

  it("waits for the cooldown when an in-flight update finishes early", async () => {
    const h = await setup();
    await h.idle();
    await h.advance(10_000);
    await h.idle();
    await h.finish(0);
    expect(h.calls).toHaveLength(1);
    await h.advance(50_000);
    expect(h.calls).toHaveLength(2);
    await h.finish(1);
  });

  it("measures cooldown from execution and coalesces a session waiting in the queue", async () => {
    const h = await setup();
    await h.idle("s1");
    await h.idle("s2");
    await h.advance(70_000);
    await h.idle("s2");
    expect(h.calls).toHaveLength(1);
    await h.finish(0);
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].payload.session_id).toBe("s2");
    await h.finish(1);
    await h.advance(10_000);
    await h.idle("s2");
    await h.advance(49_999);
    expect(h.calls).toHaveLength(2);
    await h.advance(1);
    expect(h.calls).toHaveLength(3);
    await h.finish(2);
  });

  it("serializes before/after hooks with uploads and mutates commit args in place", async () => {
    const h = await setup();
    await h.idle();
    const output = commitOutput();
    const originalArgs = output.args;
    const before = h.plugin["tool.execute.before"](commitInput, output);
    await flush();
    expect(h.calls).toHaveLength(1);
    await h.finish(0);
    expect(h.calls[1].payload.hook_event_name).toBe("tool.execute.before");
    await h.finish(1, { modified: true, args: { command: "modified commit" } });
    await before;
    expect(output.args).toBe(originalArgs);
    expect(output.args).toEqual({ command: "modified commit", description: "Commit the fix" });
    await h.plugin["tool.execute.after"](commitInput, afterOutput);
    await flush();
    expect(h.calls[2].payload.hook_event_name).toBe("tool.execute.after");
    await h.finish(2);
    await h.plugin["tool.execute.after"](commitInput, afterOutput);
    expect(h.calls).toHaveLength(3);
  });

  it("shares one queue across projects while keeping their lifecycle separate", async () => {
    const h = await setup();
    const other = await h.factory({ directory: "/other" });
    await h.idle();
    const before = other["tool.execute.before"](commitInput, commitOutput());
    await flush();
    expect(h.calls).toHaveLength(1);
    await h.finish(0);
    expect(h.calls[1].cwd).toBe("/other");
    await h.finish(1);
    await before;
    await h.plugin.dispose();
    expect(h.timers.size).toBe(0);
    await other.event({ type: "session.idle", properties: { sessionID: "s2" } });
    await flush();
    expect(h.calls[2].cwd).toBe("/other");
    await h.finish(2);
    await other.dispose();
  });

  it("continues after a failed upload and preserves pending changes", async () => {
    const h = await setup();
    await h.idle();
    await h.idle();
    const output = commitOutput();
    const before = h.plugin["tool.execute.before"](commitInput, output);
    h.calls[0].reject(new Error("upload failed"));
    await flush();
    expect(h.calls).toHaveLength(2);
    h.calls[1].reject(new Error("CLI failed"));
    await before;
    expect(output).toEqual(commitOutput());
    await h.advance(60_000);
    expect(h.calls).toHaveLength(3);
    await h.finish(2);
  });

  it("cancels pending and queued uploads on disposal", async () => {
    const h = await setup();
    await h.idle();
    await h.idle("s2");
    await h.idle();
    await h.plugin.dispose();
    await h.finish(0);
    await h.advance(120_000);
    await h.idle();
    expect(h.calls).toHaveLength(1);
    expect(h.timers.size).toBe(0);
  });

  it("ignores unrelated events and tools", async () => {
    const h = await setup();
    await h.plugin.event({ type: "session.idle", properties: {} });
    await h.plugin.event({ type: "message.updated" });
    await h.plugin["tool.execute.before"]({ ...commitInput, tool: "read" }, commitOutput());
    await h.plugin["tool.execute.before"](commitInput, { args: { command: "git status" } });
    await h.plugin["tool.execute.after"](commitInput, afterOutput);
    await flush();
    expect(h.calls).toHaveLength(0);
  });

  it("exports only one distinct plugin instance", async () => {
    const module = await import("./index");
    expect(Object.keys(module).sort()).toEqual(["agentLogsPlugin", "default"]);
    expect(module.default).toBe(module.agentLogsPlugin);
  });
});

describe("createHookQueue", () => {
  it("preserves results and recovers from a rejected task", async () => {
    const enqueue = createHookQueue();
    const first = enqueue(() => Promise.reject(new Error("boom")));
    const second = enqueue(() => Promise.resolve("next"));
    await expect(first).rejects.toThrow("boom");
    expect(await second).toBe("next");
  });
});

describe("resolveCli", () => {
  it("uses the development override", () => {
    expect(resolveCli("bun /repo/packages/cli/src/index.ts")).toEqual({
      command: "bun",
      args: ["/repo/packages/cli/src/index.ts"],
    });
  });
  it("prefers an installed agentlogs binary over npx", () => {
    expect(resolveCli("", () => "/usr/local/bin/agentlogs")).toEqual({
      command: "/usr/local/bin/agentlogs",
      args: [],
    });
  });
  it("falls back to npx when agentlogs is not on PATH", () => {
    expect(resolveCli("", () => undefined)).toEqual({ command: "npx", args: ["-y", "agentlogs@latest"] });
  });
});
