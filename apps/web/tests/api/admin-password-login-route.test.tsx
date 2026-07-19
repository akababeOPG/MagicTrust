import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticateWithPassword: vi.fn(),
}));

vi.mock("../../lib/admin-auth", () => ({
  adminSessionCookieName: "magictrust_admin_session",
  adminSessionCookieOptions: () => ({
    httpOnly: true,
    sameSite: "lax" as const,
    secure: true,
    path: "/",
    maxAge: 8 * 60 * 60,
  }),
  createAdminAuthDependencies: () => ({ appEnv: "production" }),
  createAdminAuthService: () => ({
    authenticateWithPassword: mocks.authenticateWithPassword,
  }),
  normalizeAdminReturnTo: (value: unknown) =>
    typeof value === "string" && value.startsWith("/admin/")
      ? value
      : "/admin/requests",
}));

import { POST as login } from "../../app/api/admin/auth/login/route";
import { POST as requestLink } from "../../app/api/admin/auth/request-link/route";
import { AdminLoginForm } from "../../lib/admin-login-form";

describe("admin password login route", () => {
  beforeEach(() => vi.clearAllMocks());

  test("successful login sets the secure session cookie and redirects", async () => {
    mocks.authenticateWithPassword.mockResolvedValueOnce({
      ok: true,
      sessionToken: "raw-session-token",
      session: {
        adminUserId: "admin-1",
        role: "ADMIN",
        sessionId: "session-1",
      },
    });

    const response = await login(
      loginRequest({
        email: "admin@onpointglobal.com",
        password: "correct horse battery staple",
        returnTo: "/admin/requests/MT-123",
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://magictrust.test/admin/requests/MT-123",
    );
    expect(response.headers.get("set-cookie")).toContain(
      "magictrust_admin_session=raw-session-token",
    );
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(mocks.authenticateWithPassword).toHaveBeenCalledWith({
      email: "admin@onpointglobal.com",
      password: "correct horse battery staple",
    });
  });

  test("invalid credentials use one generic error redirect", async () => {
    mocks.authenticateWithPassword.mockResolvedValueOnce({ ok: false });

    const response = await login(
      loginRequest({
        email: "unknown@onpointglobal.com",
        password: "incorrect-password",
        returnTo: "/admin/users",
      }),
    );

    expect(response.status).toBe(303);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/admin/login");
    expect(location.searchParams.get("error")).toBe("invalid_credentials");
    expect(location.searchParams.get("returnTo")).toBe("/admin/users");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  test("cross-origin login submissions are rejected generically", async () => {
    const response = await login(
      loginRequest(
        {
          email: "admin@onpointglobal.com",
          password: "correct horse battery staple",
          returnTo: "/admin/requests",
        },
        "https://malicious.example",
      ),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain(
      "error=invalid_credentials",
    );
    expect(mocks.authenticateWithPassword).not.toHaveBeenCalled();
  });

  test("login UI uses email and password without a magic-link action", () => {
    const html = renderToStaticMarkup(
      <AdminLoginForm returnTo="/admin/requests" showInvalidCredentials />,
    );

    expect(html).toContain('action="/api/admin/auth/login"');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain("Sign in");
    expect(html).toContain("Invalid email or password.");
    expect(html).not.toContain("request-link");
    expect(html).not.toContain("Send login link");
  });

  test("legacy request-link endpoint is disabled and sends no email", async () => {
    const response = await requestLink();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PASSWORD_LOGIN_REQUIRED",
        message: "Password authentication is required.",
      },
    });
    expect(mocks.authenticateWithPassword).not.toHaveBeenCalled();
  });
});

function loginRequest(
  values: Record<string, string>,
  origin = "https://magictrust.test",
) {
  return new Request("https://magictrust.test/api/admin/auth/login", {
    method: "POST",
    headers: {
      origin,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(values),
  });
}
