import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { HookPayload } from "../lib/process";

if (process.argv[2] === "descendant") {
  writeFileSync(process.argv[3], String(process.pid));
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else {
  const payload = JSON.parse(await Bun.stdin.text()) as HookPayload;
  if (payload.session_id === "hang") {
    const pidFile = payload.tool_input?.pidFile as string;
    writeFileSync(`${pidFile}.parent`, String(process.pid));
    spawn(process.execPath, [import.meta.path, "descendant", pidFile], { stdio: "inherit" });
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  } else if (payload.session_id === "invalid") {
    process.stdout.write("not JSON");
  } else if (payload.session_id === "failure") {
    process.exit(1);
  } else {
    process.stdout.write(JSON.stringify({ modified: true, args: { command: "updated", cwd: process.cwd() } }));
  }
}
