// Isolate only the CLI's user directory. The actual parser, discovery,
// permissions, redaction, local ID store, and HTTP upload are exercised.
import { mock } from "bun:test";
import * as os from "os";
const { userDir, args } = JSON.parse(process.argv[2]) as { userDir: string; args: string[] };
mock.module("os", () => ({ ...os, homedir: () => userDir }));
process.argv = [process.execPath, "agentlogs", ...args];
await import("../../cli/src/index");
