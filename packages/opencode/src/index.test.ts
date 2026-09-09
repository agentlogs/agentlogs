import { describe, expect, it } from "bun:test";
import {
  enqueueHook,
  markIdleUploadFinished,
  markIdleUploadStarted,
  resolveCli,
  shouldRunIdleUpload,
  IDLE_UPLOAD_MIN_INTERVAL_MS,
} from "./lib/hooks";

const T0 = 1_000_000_000_000;

describe("shouldRunIdleUpload", () => {
  it("allows the first upload for a session", () => {
    expect(shouldRunIdleUpload("s1", T0)).toBe(true);
  });

  it("skips while an upload is already in flight", () => {
    markIdleUploadStarted("s1", T0);
    expect(shouldRunIdleUpload("s1", T0 + 1_000)).toBe(false);
    markIdleUploadFinished("s1");
  });

  it("skips uploads within the min interval", () => {
    markIdleUploadStarted("s1", T0);
    expect(shouldRunIdleUpload("s1", T0 + IDLE_UPLOAD_MIN_INTERVAL_MS - 1)).toBe(false);
    markIdleUploadFinished("s1");
  });

  it("allows uploads after the min interval", () => {
    markIdleUploadStarted("s1", T0);
    markIdleUploadFinished("s1");
    expect(shouldRunIdleUpload("s1", T0 + IDLE_UPLOAD_MIN_INTERVAL_MS)).toBe(true);
  });

  it("tracks sessions independently", () => {
    markIdleUploadStarted("s1", T0);
    expect(shouldRunIdleUpload("s2", T0 + 1_000)).toBe(true);
    markIdleUploadFinished("s1");
  });
});

describe("enqueueHook", () => {
  it("runs tasks serially", async () => {
    const order: number[] = [];
    const slow = () =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          order.push(1);
          resolve();
        }, 20);
      });
    const fast = () => {
      order.push(2);
      return Promise.resolve();
    };

    await Promise.all([enqueueHook(slow), enqueueHook(fast)]);
    expect(order).toEqual([1, 2]);
  });

  it("keeps the chain alive when a task rejects", async () => {
    const results: string[] = [];
    await enqueueHook(() => {
      results.push("first");
      return Promise.reject(new Error("boom"));
    }).catch(() => {});
    await enqueueHook(() => {
      results.push("second");
      return Promise.resolve();
    });
    expect(results).toEqual(["first", "second"]);
  });
});

describe("resolveCli", () => {
  it("uses VI_CLI_PATH verbatim", () => {
    const cli = resolveCli("bun /repo/packages/cli/src/index.ts");
    expect(cli).toEqual({ command: "bun", args: ["/repo/packages/cli/src/index.ts"] });
  });

  it("prefers an installed agentlogs binary over npx", () => {
    const cli = resolveCli("", () => "/usr/local/bin/agentlogs");
    expect(cli).toEqual({ command: "/usr/local/bin/agentlogs", args: [] });
  });

  it("falls back to npx when agentlogs is not on PATH", () => {
    const cli = resolveCli("", () => undefined);
    expect(cli).toEqual({ command: "npx", args: ["-y", "agentlogs@latest"] });
  });
});
