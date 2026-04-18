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

  // The authenticated nav renders on the server, so it is a stable signal that the
  // seeded session cookie was accepted even if menu/tooltip triggers hydrate later.
  await expect(page.getByRole("link", { name: "Logs" })).toBeVisible();

  // Save the storage state
  await page.context().storageState({ path: AUTH_FILE });
});
