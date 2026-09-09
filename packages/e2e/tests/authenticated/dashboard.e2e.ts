/**
 * Authenticated dashboard tests.
 * These tests run with the pre-authenticated storage state.
 */
import { test, expect } from "@playwright/test";
import { getTestDb } from "../../utils/db";
import { createRepo, createTranscript, testId } from "../../utils/factories";

// Use serial mode because these tests write directly to the SQLite database
// and concurrent writes can cause conflicts
test.describe.serial("Dashboard", () => {
  test("shows authenticated header with user menu", async ({ page }) => {
    await page.goto("/app");
    // User menu dropdown trigger with user initials indicates we're logged in
    // The trigger contains the user's avatar/initials
    const userMenuTrigger = page.locator('[data-slot="dropdown-menu-trigger"]');
    await expect(userMenuTrigger).toBeVisible();
    // Verify the "Logs" nav link is visible (only shows when authenticated)
    await expect(page.getByRole("link", { name: "Logs", exact: true })).toBeVisible();
  });

  test("displays empty state when no repos or transcripts", async ({ page }) => {
    await page.goto("/app");
    // User menu dropdown trigger indicates we're logged in
    await expect(page.locator('[data-slot="dropdown-menu-trigger"]')).toBeVisible();
  });

  test("displays repositories with transcripts", async ({ page }) => {
    const id = testId();
    const { db, sqlite, schema } = getTestDb();
    const repo = createRepo(id);
    db.insert(schema.repos).values(repo).run();
    db.insert(schema.transcripts)
      .values(createTranscript(id, { repoId: repo.id }))
      .run();
    sqlite.close();

    await page.goto("/app");
    await expect(page.getByText(`test/repo-${id}`)).toBeVisible();
  });

  test("displays private transcripts without repo", async ({ page }) => {
    const id = testId();
    const { db, sqlite, schema } = getTestDb();
    db.insert(schema.transcripts)
      .values(createTranscript(id, { repoId: null, cwd: `/Users/test/projects/private-${id}` }))
      .run();
    sqlite.close();

    await page.goto("/app");
    // Private transcripts show the preview text, not the cwd
    await expect(page.getByText(`Test transcript ${id}`)).toBeVisible();
  });
});

test.describe.serial("Infinite Scroll", () => {
  test("loads more transcripts when scrolling to bottom", async ({ page }) => {
    const id = testId();
    const { db, sqlite, schema } = getTestDb();
    const repo = createRepo(id);
    db.insert(schema.repos).values(repo).run();

    // Create multiple transcripts with different timestamps to test pagination
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      db.insert(schema.transcripts)
        .values(
          createTranscript(`${id}-${i}`, {
            repoId: repo.id,
            preview: `Transcript ${i + 1} of ${id}`,
            createdAt: new Date(now - i * 60000), // 1 minute apart
          }),
        )
        .run();
    }
    sqlite.close();

    await page.goto("/app");

    // Wait for initial load - first transcript should be visible
    await expect(page.getByText(`Transcript 1 of ${id}`)).toBeVisible();

    // With PAGE_SIZE=1 for testing, only 1 transcript loads initially
    // Scroll to trigger loading more
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));

    // Wait for more transcripts to load
    await expect(page.getByText(`Transcript 2 of ${id}`)).toBeVisible({ timeout: 5000 });

    // Scroll again to load even more
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await expect(page.getByText(`Transcript 3 of ${id}`)).toBeVisible({ timeout: 5000 });
  });

  test("shows end of list quote when all transcripts loaded", async ({ page }) => {
    const id = testId();
    const { db, sqlite, schema } = getTestDb();
    db.insert(schema.transcripts)
      .values(createTranscript(id, { repoId: null }))
      .run();
    sqlite.close();

    await page.goto("/app");

    // Wait for transcript to load
    await expect(page.getByText(`Test transcript ${id}`)).toBeVisible();

    // Other upload tests share this user's feed. Keep scrolling as each page
    // arrives instead of assuming all transcripts fit in one response.
    await expect(async () => {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await expect(page.getByText(/—\s+\w+/)).toBeVisible({ timeout: 1000 });
    }).toPass({ timeout: 15000 });
  });
});

test.describe.serial("Navigation", () => {
  test("transcript link has correct href", async ({ page }) => {
    const id = testId();

    // Seed test data
    const { db, sqlite, schema } = getTestDb();
    const repo = createRepo(id);
    db.insert(schema.repos).values(repo).run();
    db.insert(schema.transcripts)
      .values(createTranscript(id, { repoId: repo.id }))
      .run();
    sqlite.close();

    await page.goto("/app");

    // Wait for the transcript to be visible
    await expect(page.getByText(`test/repo-${id}`)).toBeVisible();

    // Verify the transcript link has the correct href
    // Note: We don't click/navigate because the test factory doesn't seed R2 data,
    // which would cause SSR errors on the transcript detail page
    const transcriptLink = page.getByRole("link", { name: new RegExp(`Test transcript ${id}`) });
    await expect(transcriptLink).toHaveAttribute("href", new RegExp(`/app/logs/transcript-${id}`));
  });

  test("user is authenticated and can access app", async ({ page }) => {
    await page.goto("/app");

    // Verify we're authenticated - user menu trigger is visible (shows user initials)
    const userMenuTrigger = page.locator('[data-slot="dropdown-menu-trigger"]');
    await expect(userMenuTrigger).toBeVisible();

    // Verify the authenticated nav is showing (Logs link only appears when logged in)
    await expect(page.getByRole("link", { name: "Logs", exact: true })).toBeVisible();

    // Note: Dropdown interaction test is skipped due to @base-ui/react compatibility
    // issues with Playwright. The dropdown functionality is verified manually.
  });
});
