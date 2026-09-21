import { describe, expect, it } from "bun:test";
import { createHookQueue, resolveCli, type Clock } from "./lib/hooks";
import {
  createAgentLogsPlugin,
  isPublishTrigger,
  type ToolExecuteAfterEvent,
  type ToolExecuteBeforeEvent,
} from "./lib/plugin";
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
  const agent = createAgentLogsPlugin({
    clock: time.clock,
    run: (payload, cwd) => new Promise((resolve, reject) => calls.push({ payload, cwd, resolve, reject })),
  });
  const handlers = agent.handlers("/project");
  const idle = (sessionID = "s1") => handlers.scheduleIdle(sessionID);
  const finish = async (index: number, response: HookResponse = { modified: false }) => {
    calls[index].resolve(response);
    await flush();
  };
  return { ...time, calls, agent, handlers, idle, finish };
}

const commitBefore = (overrides: Partial<ToolExecuteBeforeEvent> = {}): ToolExecuteBeforeEvent => ({
  tool: "bash",
  sessionID: "s1",
  id: "c1",
  input: { command: 'git commit -m "Fix"', description: "Commit the fix" },
  ...overrides,
});

const afterCompleted = (overrides: Partial<ToolExecuteAfterEvent> = {}): ToolExecuteAfterEvent => ({
  tool: "bash",
  sessionID: "s1",
  id: "c1",
  status: "completed",
  input: { command: 'git commit -m "Fix"' },
  result: { content: "[main 1234567] Fix", metadata: {} },
  ...overrides,
});

describe("OpenCode plugin handlers", () => {
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
    const event = commitBefore();
    const originalInput = event.input;
    const before = h.handlers.before(event);
    await flush();
    expect(h.calls).toHaveLength(1);
    await h.finish(0);
    expect(h.calls[1].payload.hook_event_name).toBe("tool.execute.before");
    expect(h.calls[1].payload.opencode_version).toBe("2");
    await h.finish(1, { modified: true, args: { command: "modified commit" } });
    await before;
    expect(event.input).toBe(originalInput);
    expect(event.input).toEqual({ command: "modified commit", description: "Commit the fix" });
    await h.handlers.after(afterCompleted());
    await flush();
    expect(h.calls[2].payload.hook_event_name).toBe("tool.execute.after");
    await h.finish(2);
    await h.handlers.after(afterCompleted());
    expect(h.calls).toHaveLength(3);
  });

  it("shares one queue across projects while keeping their lifecycle separate", async () => {
    const h = await setup();
    const other = h.agent.handlers("/other");
    await h.idle();
    const before = other.before(commitBefore());
    await flush();
    expect(h.calls).toHaveLength(1);
    await h.finish(0);
    expect(h.calls[1].cwd).toBe("/other");
    await h.finish(1);
    await before;
    await h.handlers.dispose();
    expect(h.timers.size).toBe(0);
    other.scheduleIdle("s2");
    await flush();
    expect(h.calls[2].cwd).toBe("/other");
    await h.finish(2);
    await other.dispose();
  });

  it("continues after a failed upload and preserves pending changes", async () => {
    const h = await setup();
    await h.idle();
    await h.idle();
    const event = commitBefore();
    const before = h.handlers.before(event);
    h.calls[0].reject(new Error("upload failed"));
    await flush();
    expect(h.calls).toHaveLength(2);
    h.calls[1].reject(new Error("CLI failed"));
    await before;
    expect(event.input).toEqual({ command: 'git commit -m "Fix"', description: "Commit the fix" });
    await h.advance(60_000);
    expect(h.calls).toHaveLength(3);
    await h.finish(2);
  });

  it("cancels pending and queued uploads on disposal", async () => {
    const h = await setup();
    await h.idle();
    await h.idle("s2");
    await h.idle();
    await h.handlers.dispose();
    await h.finish(0);
    await h.advance(120_000);
    await h.idle();
    expect(h.calls).toHaveLength(1);
    expect(h.timers.size).toBe(0);
  });

  it("ignores unrelated events and tools", async () => {
    const h = await setup();
    h.handlers.scheduleIdle("");
    await h.handlers.before(commitBefore({ tool: "read" }));
    await h.handlers.before(commitBefore({ input: { command: "git status" } }));
    await h.handlers.after(afterCompleted({ tool: "read" }));
    await h.handlers.after(afterCompleted({ result: { content: "[main 1234567] Fix", metadata: {} } }));
    await flush();
    expect(h.calls).toHaveLength(0);
  });

  it("exports one plugin instance with v1 server and v2 setup entrypoints", async () => {
    const module = await import("./index");
    expect(Object.keys(module).sort()).toEqual(["default"]);
    const plugin = module.default;
    expect(plugin.id).toBe("agentlogs");
    expect(typeof plugin.setup).toBe("function");
    expect(typeof plugin.server).toBe("function");
  });
});

describe("OpenCode 1 server adapter", () => {
  async function v1Setup() {
    const time = fakeClock();
    const calls: {
      payload: HookPayload;
      cwd: string;
      resolve: (r: HookResponse) => void;
      reject: (e: Error) => void;
    }[] = [];
    const agent = createAgentLogsPlugin({
      clock: time.clock,
      run: (payload, cwd) => new Promise((resolve, reject) => calls.push({ payload, cwd, resolve, reject })),
    });
    const hooks = await agent.plugin.server({ directory: "/v1project", project: { id: "p1", path: "/v1project" } });
    const finish = async (index: number, response: HookResponse = { modified: false }) => {
      calls[index].resolve(response);
      await flush();
    };
    return { ...time, calls, hooks, finish };
  }

  it("maps v1 sessions.idle events and tags payloads as opencode v1", async () => {
    const h = await v1Setup();
    h.hooks.event({ type: "session.idle", properties: { sessionID: "s1" } });
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].payload.hook_event_name).toBe("session.idle");
    expect(h.calls[0].payload.cwd).toBe("/v1project");
    expect(h.calls[0].payload.opencode_version).toBe("1");
    await h.finish(0);
  });

  it("accepts the legacy wrapped event shape and ignores unrelated events", async () => {
    const h = await v1Setup();
    h.hooks.event({ event: { type: "session.idle", properties: { sessionID: "s1" } } });
    h.hooks.event({ type: "message.updated" });
    await flush();
    expect(h.calls).toHaveLength(1);
    await h.finish(0);
  });

  it("intercepts git commits via tool.execute.before and mutates args in place", async () => {
    const h = await v1Setup();
    const output = { args: { command: 'git commit -m "Fix"', description: "Commit the fix" } };
    const before = h.hooks["tool.execute.before"]({ tool: "bash", sessionID: "s1", callID: "c1" }, output);
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0].payload.opencode_version).toBe("1");
    await h.finish(0, { modified: true, args: { command: "modified commit" } });
    await before;
    expect(output.args).toEqual({ command: "modified commit", description: "Commit the fix" });
    // Intercepted call id is tracked; a matching after hook triggers the CLI.
    await h.hooks["tool.execute.after"](
      { tool: "bash", sessionID: "s1", callID: "c1" },
      { output: "[main 1234567] Fix", metadata: { exit: 0 } },
    );
    await flush();
    expect(h.calls[1].payload.hook_event_name).toBe("tool.execute.after");
    expect(h.calls[1].payload.tool_output).toEqual({ output: "[main 1234567] Fix", metadata: { exit: 0 } });
    expect(h.calls[1].payload.opencode_version).toBe("1");
    await h.finish(1);
  });
});

describe("publish triggers", () => {
  it("treats idle and execution completion as publish triggers", () => {
    expect(isPublishTrigger("session.idle")).toBe(true);
    expect(isPublishTrigger("session.execution.succeeded")).toBe(true);
    expect(isPublishTrigger("session.execution.failed")).toBe(true);
    expect(isPublishTrigger("session.execution.interrupted")).toBe(true);
  });

  it("ignores unrelated session activity", () => {
    expect(isPublishTrigger("session.step.started")).toBe(false);
    expect(isPublishTrigger("session.tool.called")).toBe(false);
    expect(isPublishTrigger("session.text.delta")).toBe(false);
    expect(isPublishTrigger("message.updated")).toBe(false);
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
