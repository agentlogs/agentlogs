/**
 * Auth setup for Playwright tests.
 *
 * This creates a storage state file with the session cookie that can be reused
 * across tests. The session and auth env are pre-seeded by start-test-server.ts
 * before vite starts.
 */
import { expect, test as setup } from "@playwright/test";
import path from "path";
import fs from "fs";
import { signCookie, TEST_AUTH_SECRET } from "../utils/sign-cookie";

const AUTH_FILE = path.join(import.meta.dirname!, "../.auth/user.json");

setup("authenticate", async ({ page }) => {
  // Ensure .auth directory exists
  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  // Navigate to the app to get the page context
  await page.goto("/");

  // Set the session cookie that matches our seeded session
  // Better Auth uses 'better-auth.session_token' as the cookie name
  // The cookie value must be signed with HMAC-SHA256: "token.signature"
  const signedToken = signCookie("test-session-token", TEST_AUTH_SECRET);
  const oneWeekFromNow = Date.now() / 1000 + 7 * 24 * 60 * 60;

  await page.context().addCookies([
    {
      name: "better-auth.session_token",
      value: signedToken,
      domain: "localhost",
      path: "/",
      httpOnly: true,
      secure: false,
      sameSite: "Lax" as const,
      expires: oneWeekFromNow,
    },
  ]);

  // Verify auth works by navigating to /app
  await page.goto("/app");

  // Assert we stayed on the authenticated app shell and found the exact nav link,
  // not the unauthenticated landing-page brand link containing "AgentLogs".
  const logsNavLink = page.getByRole("link", { name: "Logs", exact: true });
  await expect(page).toHaveURL(/\/app$/);
  await expect(logsNavLink).toBeVisible();
  await expect(logsNavLink).toHaveAttribute("href", "/app");

  // Save the storage state
  await page.context().storageState({ path: AUTH_FILE });
});
