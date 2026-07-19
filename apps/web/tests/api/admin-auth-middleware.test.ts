import { NextRequest } from "next/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { middleware } from "../../middleware";

describe("admin authentication middleware", () => {
  test("preserves the intended destination for unauthenticated admin pages", () => {
    const response = middleware(
      new NextRequest(
        "https://magictrust.test/admin/requests/MT-123?tab=activity",
      ),
    );
    const location = new URL(response.headers.get("location")!);

    expect(location.pathname).toBe("/admin/login");
    expect(location.searchParams.get("returnTo")).toBe(
      "/admin/requests/MT-123?tab=activity",
    );
  });

  test("allows login, legacy verification, and requests with a session cookie", () => {
    const login = middleware(
      new NextRequest("https://magictrust.test/admin/login"),
    );
    const verify = middleware(
      new NextRequest(
        "https://magictrust.test/admin/auth/verify?token=legacy-token",
      ),
    );
    const authenticated = middleware(
      new NextRequest("https://magictrust.test/admin/requests", {
        headers: {
          cookie: "magictrust_admin_session=session-token",
        },
      }),
    );

    expect(login.headers.get("x-middleware-next")).toBe("1");
    expect(verify.headers.get("x-middleware-next")).toBe("1");
    expect(authenticated.headers.get("x-middleware-next")).toBe("1");
  });
});
