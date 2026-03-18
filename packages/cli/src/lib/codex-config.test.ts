import { describe, expect, it } from "bun:test";
import { updateCodexConfigContents, updateHooksFileContents } from "./codex-config";

describe("updateCodexConfigContents", () => {
  it("enables codex_hooks in an existing features section", () => {
    const input = `model = "gpt-5.4"

[features]
unified_exec = true
`;

    const result = updateCodexConfigContents(input);

    expect(result).toContain("[features]");
    expect(result).toContain("codex_hooks = true");
    expect(result).toContain("unified_exec = true");
  });

  it("creates a features section when none exists", () => {
    const input = `model = "gpt-5.4"\n`;
    const result = updateCodexConfigContents(input);

    expect(result).toContain("[features]");
    expect(result).toContain("codex_hooks = true");
  });
});

describe("updateHooksFileContents", () => {
  it("installs AgentLogs SessionStart and Stop hooks while preserving unrelated hooks", () => {
    const input = JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: "echo keep-me",
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    );

    const output = updateHooksFileContents(input, "npx -y agentlogs codex hook");
    const parsed = JSON.parse(output) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string; statusMessage?: string }> }>>;
    };

    expect(parsed.hooks.SessionStart).toHaveLength(1);
    expect(parsed.hooks.SessionStart[0].hooks[0].command).toBe("npx -y agentlogs codex hook");
    expect(parsed.hooks.SessionStart[0].hooks[0].statusMessage).toBeUndefined();
    expect(parsed.hooks.Stop).toHaveLength(2);
    expect(parsed.hooks.Stop.some((group) => group.hooks[0].command === "echo keep-me")).toBe(true);
  });

  it("replaces existing AgentLogs Codex hook groups instead of duplicating them", () => {
    const input = JSON.stringify(
      {
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: "npx -y agentlogs codex hook",
                },
              ],
            },
          ],
        },
      },
      null,
      2,
    );

    const output = updateHooksFileContents(input, "npx -y agentlogs codex hook");
    const parsed = JSON.parse(output) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };

    expect(parsed.hooks.Stop.filter((group) => group.hooks[0].command === "npx -y agentlogs codex hook")).toHaveLength(
      1,
    );
  });
});
