import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const redirectMock = vi.fn((target: string) => {
  throw new Error(`REDIRECT:${target}`);
});

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => undefined),
  })),
}));

describe("admin session guard", () => {
  test("unauthenticated admin pages redirect to login", async () => {
    const { requireAdminSession } = await import("../../lib/admin-auth");

    await expect(requireAdminSession()).rejects.toThrow(
      "REDIRECT:/admin/login",
    );
    expect(redirectMock).toHaveBeenCalledWith("/admin/login");
  });

  test("unauthenticated admin API routes return normalized 401", async () => {
    const { requireAdminSession } = await import("../../lib/admin-auth");

    const response = await requireAdminSession({ response: "json" });

    expect(response).toBeInstanceOf(Response);
    expect(response instanceof Response ? response.status : null).toBe(401);
    await expect(
      response instanceof Response ? response.json() : null,
    ).resolves.toEqual({
      error: {
        code: "UNAUTHORIZED",
        message: "Admin authentication is required.",
      },
    });
  });
});
