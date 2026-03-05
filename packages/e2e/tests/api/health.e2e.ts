import { test, expect } from "@playwright/test";

test.describe("API Health", () => {
  test("health endpoint returns ok JSON", async ({ request }) => {
    const response = await request.get("/healthz");
    expect(response.ok()).toBe(true);
    expect(response.headers()["content-type"]).toContain("application/json");
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  test("health endpoint supports HEAD", async ({ request }) => {
    const response = await request.head("/healthz");
    expect(response.status()).toBe(200);
  });
});
