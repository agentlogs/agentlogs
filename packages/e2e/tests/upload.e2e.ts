import { test, expect } from "@playwright/test";
import { $ } from "bun";
import path from "path";

const ROOT_DIR = path.resolve(import.meta.dirname!, "../../..");
const TEST_AUTH_TOKEN = "test-session-token";
const SERVER_URL = "http://localhost:3009";

type FixtureCase = {
  cwd: string;
  expectedSnippet: string;
  fixturePath: string;
  uploadCommand: string;
};

async function uploadFixtureTranscript(fixture: FixtureCase): Promise<string> {
  return await $`bun agentlogs ${fixture.uploadCommand} upload ${fixture.fixturePath}`
    .cwd(ROOT_DIR)
    .env({
      ...process.env,
      SERVER_URL,
      AGENTLOGS_AUTH_TOKEN: TEST_AUTH_TOKEN,
    })
    .text();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function assertTranscriptInUi(page: Parameters<typeof test>[0]["page"], fixture: FixtureCase) {
  await page.goto("/app");

  const cwdRow = page.getByRole("row", { name: new RegExp(escapeRegex(fixture.cwd)) });
  await expect(cwdRow).toBeVisible();
  await cwdRow.getByRole("link", { name: "View" }).click();

  const previewRow = page.getByRole("row", { name: new RegExp(escapeRegex(fixture.expectedSnippet)) });
  await expect(previewRow).toBeVisible();
  await previewRow.getByRole("link", { name: "View" }).click();

  await expect(page.getByText(fixture.expectedSnippet)).toBeVisible();
}

test.describe("CLI Upload", () => {
  test("uploads claudecode crud fixture and shows it in the UI", async ({ page }) => {
    const fixture = {
      cwd: "/Users/philipp/dev/vibeinsights/fixtures/claudecode",
      expectedSnippet: "create a file `JOKE.md` with a ranom joke",
      fixturePath: path.join(ROOT_DIR, "fixtures/claudecode/crud.jsonl"),
      uploadCommand: "claudecode",
    } satisfies FixtureCase;
    const output = await uploadFixtureTranscript(fixture);
    expect(output).toContain("Upload successful");

    await assertTranscriptInUi(page, fixture);
  });

  test("uploads claudecode compact fixture and shows it in the UI", async ({ page }) => {
    const fixture = {
      cwd: "/Users/philipp/dev/studio",
      expectedSnippet: "how are you doing",
      fixturePath: path.join(ROOT_DIR, "fixtures/claudecode/compact.jsonl"),
      uploadCommand: "claudecode",
    } satisfies FixtureCase;
    const output = await uploadFixtureTranscript(fixture);
    expect(output).toContain("Upload successful");

    await assertTranscriptInUi(page, fixture);
  });

  test("uploads claudecode images fixture and shows it in the UI", async ({ page }) => {
    const fixture = {
      cwd: "/Users/philipp/dev/vibeinsights",
      expectedSnippet: "go to google.com, make a screenshoot, look at it, and tell me what you think",
      fixturePath: path.join(ROOT_DIR, "fixtures/claudecode/images.jsonl"),
      uploadCommand: "claudecode",
    } satisfies FixtureCase;
    const output = await uploadFixtureTranscript(fixture);
    expect(output).toContain("Upload successful");

    await assertTranscriptInUi(page, fixture);
  });

  test("uploads claudecode subagent fixture and shows it in the UI", async ({ page }) => {
    const fixture = {
      cwd: "/Users/philipp/dev/studio",
      expectedSnippet: "ask a subagent how he's doing",
      fixturePath: path.join(ROOT_DIR, "fixtures/claudecode/subagent.jsonl"),
      uploadCommand: "claudecode",
    } satisfies FixtureCase;
    const output = await uploadFixtureTranscript(fixture);
    expect(output).toContain("Upload successful");

    await assertTranscriptInUi(page, fixture);
  });

  test("uploads claudecode todos fixture and shows it in the UI", async ({ page }) => {
    const fixture = {
      cwd: "/Users/philipp/dev/vibeinsights/fixtures/claudecode",
      expectedSnippet: "create a todo list with 3 items",
      fixturePath: path.join(ROOT_DIR, "fixtures/claudecode/todos.jsonl"),
      uploadCommand: "claudecode",
    } satisfies FixtureCase;
    const output = await uploadFixtureTranscript(fixture);
    expect(output).toContain("Upload successful");

    await assertTranscriptInUi(page, fixture);
  });

  test("uploads codex crud fixture and shows it in the UI", async ({ page }) => {
    const fixture = {
      cwd: "/Users/philipp/dev/vibeinsights/fixtures",
      expectedSnippet: "create a file `JOKE.md` with a random joke",
      fixturePath: path.join(ROOT_DIR, "fixtures/codex/crud.jsonl"),
      uploadCommand: "codex",
    } satisfies FixtureCase;
    const output = await uploadFixtureTranscript(fixture);
    expect(output).toContain("Upload successful");

    await assertTranscriptInUi(page, fixture);
  });
});
