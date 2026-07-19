import {
  hashApiKey,
  type ApiClientManagementStore,
  type ManagedApiClient,
} from "@magictrust/database";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  AdminApiClientDirectory,
  reduceApiClientCreationState,
} from "../../lib/admin-api-client-directory";
import { AdminShell } from "../../lib/admin-ui";
import {
  createManagedApiClient,
  revokeManagedApiClient,
  type AdminApiClientDependencies,
} from "../../lib/admin-api-client-management";

describe("admin API client management", () => {
  test("ADMIN can list clients with the supported processor scopes", () => {
    const html = renderToStaticMarkup(
      <AdminApiClientDirectory
        clients={[client()]}
        scopeOptions={scopeOptions}
      />,
    );
    expect(html).toContain("API Clients");
    expect(html).toContain("requests:processing-result:write");
    expect(html).toContain("+1 more");
    expect(html).toContain("Last used");
  });

  test("API Clients uses the shared Administration navigation row", () => {
    const html = renderToStaticMarkup(
      <AdminShell session={session} currentSection="api-clients">
        <span>Content</span>
      </AdminShell>,
    );
    expect(html).toContain('href="/admin/api-clients"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('viewBox="0 0 24 24" width="18" height="18"');
  });

  test("Cancel closes the create modal without changing the URL", () => {
    const initial = {
      createOpen: true,
      created: null,
      clients: [client()],
    };
    const state = reduceApiClientCreationState(initial, {
      type: "CANCEL_CREATE",
    });
    expect(state.createOpen).toBe(false);
    expect(state.clients).toEqual(initial.clients);
  });

  test("successful creation stays on the list and returns the secret once", async () => {
    const fixture = dependencies();
    const form = new FormData();
    form.set("name", "Privacy Processor");
    form.append("scopes", "requests:read");
    form.append("scopes", "requests:processing-result:write");
    const response = await createManagedApiClient(
      request("/admin/api-clients/create", form),
      session,
      fixture,
    );
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(response.headers.get("location")).toBeNull();
    expect(JSON.stringify(body).match(/mt_live_test-secret/g)).toHaveLength(1);
    expect(body.client.name).toBe("Privacy Processor");
    expect(JSON.stringify(fixture.state)).not.toContain("mt_live_test-secret");
    expect(fixture.state.keyHash).toBe(hashApiKey("mt_live_test-secret"));
  });

  test("success adds the client and Done clears the one-time secret", () => {
    const created = {
      client: { ...client(), id: "client-2", name: "New processor" },
      apiKey: "mt_live_one-time",
    };
    const success = reduceApiClientCreationState(
      { createOpen: true, created: null, clients: [client()] },
      { type: "CREATED", value: created },
    );
    expect(success.createOpen).toBe(false);
    expect(success.created?.apiKey).toBe("mt_live_one-time");
    expect(success.clients[0]?.name).toBe("New processor");

    const done = reduceApiClientCreationState(success, { type: "DONE" });
    expect(done.created).toBeNull();
    expect(done.clients[0]?.name).toBe("New processor");
  });

  test("ADMIN can revoke and revoked credentials fail authentication", async () => {
    const fixture = dependencies();
    expect(fixture.authenticate("mt_live_test-secret")).toBe(true);
    const response = await revokeManagedApiClient(
      request("/admin/api-clients/client-1/revoke", new FormData()),
      "client-1",
      session,
      fixture,
    );
    expect(response.status).toBe(303);
    expect(fixture.authenticate("mt_live_test-secret")).toBe(false);
  });
});

const session = {
  adminUserId: "admin-1",
  role: "ADMIN" as const,
  sessionId: "session-1",
};

const scopeOptions = [
  { value: "requests:read", label: "requests:read" },
  {
    value: "requests:processing-data:read",
    label: "requests:processing-data:read",
  },
  { value: "requests:create", label: "requests:create" },
  { value: "requests:update", label: "requests:update" },
  {
    value: "requests:processing-result:write",
    label: "requests:processing-result:write",
  },
  { value: "attachments:read", label: "attachments:read" },
  { value: "attachments:write", label: "attachments:write" },
  { value: "communications:write", label: "communications:write" },
  { value: "notifications:write", label: "notifications:write" },
  { value: "comments:write", label: "comments:write" },
  { value: "events:write", label: "events:write" },
];

function dependencies(): AdminApiClientDependencies & {
  state: { active: boolean; keyHash: string | null };
  authenticate(rawKey: string): boolean;
} {
  const state = {
    active: true,
    keyHash: hashApiKey("mt_live_test-secret") as string | null,
  };
  const store: ApiClientManagementStore = {
    async listApiClients() {
      return [client()];
    },
    async createApiClient(input) {
      state.keyHash = hashApiKey(input.rawKey);
      return client();
    },
    async revokeApiClient() {
      state.active = false;
      return true;
    },
  };
  return {
    store,
    now: () => new Date("2026-07-19T12:00:00Z"),
    generateKey: () => "mt_live_test-secret",
    state,
    authenticate: (rawKey) =>
      state.active && state.keyHash === hashApiKey(rawKey),
  };
}

function client(): ManagedApiClient {
  return {
    id: "client-1",
    name: "Privacy Processor",
    active: true,
    scopes: [
      "requests:read",
      "requests:processing-data:read",
      "requests:update",
      "requests:processing-result:write",
    ],
    createdAt: new Date("2026-07-19T12:00:00Z"),
    lastUsedAt: null,
  };
}

function request(path: string, body: FormData): Request {
  return new Request(`https://magictrust.test${path}`, {
    method: "POST",
    headers: { origin: "https://magictrust.test" },
    body,
  });
}
