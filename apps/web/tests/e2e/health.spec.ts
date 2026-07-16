import { expect, test } from "@playwright/test";

test("health endpoint reports application status", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = await response.json();

  expect([200, 503]).toContain(response.status());
  expect(body.app).toBe("MagicTrust");
  expect(["ok", "degraded"]).toContain(body.status);
  expect(body.database).toBeDefined();
  expect(body.checkedAt).toEqual(expect.any(String));
});
