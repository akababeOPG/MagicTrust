import type {
  CreatePrivacyRequestRecord,
  CreateRequestEventRecord,
  CreateRequesterRecord,
  PrivacyRequest,
  RequestAccessSession,
  RequestAccessToken,
  RequestAttachment,
  RequestComment,
  RequestCommunication,
  RequestCreationStore,
  RequestEvent,
  RequestIdentityVerificationToken,
  Requester,
} from "@magictrust/domain";
import type {
  RequestDetails,
  RequestListFilters,
  RequestRepository,
  RequestSummary,
} from "@magictrust/database";
import type { EmailProvider } from "@magictrust/email";
import {
  hashAccessSession,
  hashAccessToken,
  hashIdentityVerificationToken,
} from "@magictrust/privacy";
import type { PrivateFileStorageProvider } from "@magictrust/storage";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";

import PrivacyRequestFormPage from "../../app/forms/privacy-request/page";
import PublicRequestLookupPage from "../../app/requests/page";
import { PrivacyRequestConfirmation } from "../../lib/privacy-request-confirmation";
import { submitPrivacyRequestForm } from "../../lib/privacy-request-form-submit";
import {
  createPublicRequestApi,
  downloadPublicAttachmentForConsumer,
  exchangeConsumerAccessTokenForSession,
  getPublicSecureAccessData,
  verifyPublicRequestIdentity,
} from "../../lib/public-request-api";
import { PublicSecureAccessView } from "../../lib/public-secure-access-view";
import { PublicRequestTrackingView } from "../../lib/public-request-tracking-view";

process.env.ENCRYPTION_KEY = "test-encryption-key-for-public-intake";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("public request API", () => {
  test("validates required fields", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(
      publicRequest({
        email: "",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("creates a request without requiring an API key", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.request).toMatchObject({
      publicId: expect.stringMatching(/^req_/),
      type: "DATA_ACCESS",
      status: "PENDING_VERIFICATION",
      createdAt: expect.any(String),
    });
  });

  test("DATA_ACCESS starts PENDING_VERIFICATION", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest({ type: "DATA_ACCESS" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.request.status).toBe("PENDING_VERIFICATION");
  });

  test("DATA_DELETION starts PENDING_VERIFICATION", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest({ type: "DATA_DELETION" }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.request.status).toBe("PENDING_VERIFICATION");
  });

  test.each(["DO_NOT_CONTACT", "UNSUBSCRIBE", "GENERAL_INQUIRY"] as const)(
    "%s remains SUBMITTED",
    async (type) => {
      const dependencies = createInMemoryDependencies();
      const api = createPublicRequestApi(dependencies);

      const response = await api.create(publicRequest({ type }));
      const body = await response.json();

      expect(response.status).toBe(201);
      expect(body.request.status).toBe("SUBMITTED");
    },
  );

  test("does not expose internal fields", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest());
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(201);
    expect(serialized).not.toContain("id");
    expect(serialized).not.toContain("requesterId");
    expect(serialized).not.toContain("emailEncrypted");
    expect(serialized).not.toContain("emailHash");
    expect(serialized).not.toContain("phoneEncrypted");
    expect(serialized).not.toContain("phoneHash");
    expect(serialized).not.toContain("events");
    expect(serialized).not.toContain("comments");
    expect(serialized).not.toContain("attachments");
    expect(serialized).not.toContain("communications");
    expect(serialized).not.toContain("providerMessageId");
  });

  test("rejects honeypot submissions", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(
      publicRequest({
        website: "filled-by-bot",
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_ERROR");
  });

  test("sends a receipt email after public request creation", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest());
    const body = await response.json();
    const request = dependencies.state.requests[0];

    expect(response.status).toBe(201);
    expect(dependencies.state.sentEmails).toEqual([
      expect.objectContaining({
        to: "john@example.com",
        subject: `MagicTrust request received: ${body.request.publicId}`,
        body: expect.stringContaining(
          `Reference number: ${body.request.publicId}`,
        ),
      }),
    ]);
    expect(dependencies.state.sentEmails[0]?.body).toContain(
      `https://magictrust.test/requests/${body.request.publicId}`,
    );
    expect(dependencies.state.communications).toEqual([
      expect.objectContaining({
        requestId: request.id,
        channel: "EMAIL",
        direction: "OUTBOUND",
        provider: "resend",
        status: "SENT",
        actorType: "SYSTEM",
        actorId: "public-intake",
      }),
    ]);
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          privacyRequestId: request.id,
          type: "EMAIL_SENT",
          actorType: "SYSTEM",
          actorId: "public-intake",
        }),
      ]),
    );
  });

  test("keeps public response contract when receipt email is sent", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toEqual({
      request: {
        publicId: expect.stringMatching(/^req_/),
        type: "DATA_ACCESS",
        status: "PENDING_VERIFICATION",
        createdAt: expect.any(String),
      },
    });
  });

  test("failed receipt email still creates the request", async () => {
    const dependencies = createInMemoryDependencies({
      emailShouldFail: true,
    });
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.request).toMatchObject({
      publicId: expect.stringMatching(/^req_/),
      status: "PENDING_VERIFICATION",
    });
    expect(dependencies.state.requests).toHaveLength(1);
  });

  test("failed receipt email records communication failure and event", async () => {
    const dependencies = createInMemoryDependencies({
      emailShouldFail: true,
    });
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest());
    const request = dependencies.state.requests[0];

    expect(response.status).toBe(201);
    expect(dependencies.state.communications).toEqual([
      expect.objectContaining({
        requestId: request.id,
        provider: "resend",
        status: "FAILED",
        errorMessage: "Email provider failed to send the message.",
        actorType: "SYSTEM",
        actorId: "public-intake",
      }),
    ]);
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          privacyRequestId: request.id,
          type: "EMAIL_FAILED",
          actorType: "SYSTEM",
          actorId: "public-intake",
        }),
      ]),
    );
  });

  test("identity verification token is stored hashed, not raw", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    await api.create(publicRequest({ type: "DATA_ACCESS" }));
    const token = extractVerificationTokenFromEmail(
      dependencies.state.sentEmails.at(-1),
    );

    expect(dependencies.state.identityVerificationTokens).toHaveLength(1);
    expect(
      dependencies.state.identityVerificationTokens[0]?.tokenHash,
    ).not.toBe(token);
    expect(dependencies.state.identityVerificationTokens[0]?.tokenHash).toBe(
      hashIdentityVerificationToken(token),
    );
  });

  test("verification email contains the verification link", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.create(publicRequest({ type: "DATA_DELETION" }));
    const body = await response.json();

    expect(dependencies.state.sentEmails.at(-1)?.body).toContain(
      `https://magictrust.test/requests/${body.request.publicId}/verify?token=`,
    );
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          privacyRequestId: dependencies.state.requests[0].id,
          type: "IDENTITY_VERIFICATION_SENT",
          actorType: "SYSTEM",
          actorId: "public-intake",
        }),
      ]),
    );
  });

  test("valid identity token changes status to VERIFIED", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);
    const response = await api.create(publicRequest({ type: "DATA_ACCESS" }));
    const body = await response.json();
    const token = extractVerificationTokenFromEmail(
      dependencies.state.sentEmails.at(-1),
    );

    const verified = await verifyPublicRequestIdentity(
      dependencies,
      body.request.publicId,
      token,
    );

    expect(verified).toBe(true);
    expect(dependencies.state.requests[0].status).toBe("VERIFIED");
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          privacyRequestId: dependencies.state.requests[0].id,
          type: "IDENTITY_VERIFIED",
          actorType: "CONSUMER",
          actorId: null,
        }),
      ]),
    );
  });

  test("expired identity token is rejected", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);
    const response = await api.create(publicRequest({ type: "DATA_ACCESS" }));
    const body = await response.json();
    const token = extractVerificationTokenFromEmail(
      dependencies.state.sentEmails.at(-1),
    );
    dependencies.state.identityVerificationTokens[0]!.expiresAt = new Date(
      Date.UTC(2025, 0, 1),
    );

    await expect(
      verifyPublicRequestIdentity(dependencies, body.request.publicId, token),
    ).resolves.toBe(false);
    expect(dependencies.state.requests[0].status).toBe("PENDING_VERIFICATION");
  });

  test("used identity token is rejected", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);
    const response = await api.create(publicRequest({ type: "DATA_ACCESS" }));
    const body = await response.json();
    const token = extractVerificationTokenFromEmail(
      dependencies.state.sentEmails.at(-1),
    );

    await verifyPublicRequestIdentity(
      dependencies,
      body.request.publicId,
      token,
    );

    await expect(
      verifyPublicRequestIdentity(dependencies, body.request.publicId, token),
    ).resolves.toBe(false);
  });

  test("tracks a public request with public-safe data only", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);
    const createResponse = await api.create(publicRequest());
    const createBody = await createResponse.json();
    const request = dependencies.state.requests[0];

    dependencies.state.comments.push(
      {
        id: "comment-public",
        requestId: request.id,
        visibility: "PUBLIC",
        body: "Your request is being processed.",
        actorType: "API_CLIENT",
        actorId: "privacy-processor",
        createdAt: new Date(Date.UTC(2026, 0, 2)),
      },
      {
        id: "comment-internal",
        requestId: request.id,
        visibility: "INTERNAL",
        body: "Internal reviewer note.",
        actorType: "INTERNAL_USER",
        actorId: "reviewer-1",
        createdAt: new Date(Date.UTC(2026, 0, 2)),
      },
    );
    dependencies.state.attachments.push({
      id: "attachment-1",
      requestId: request.id,
      visibility: "PUBLIC",
      fileName: "data-export.json",
      mimeType: "application/json",
      sizeBytes: 123,
      storageProvider: "vercel_blob",
      storageKey: "requests/req_test/attachments/file.json",
      checksum: "sha256-placeholder",
      actorType: "API_CLIENT",
      actorId: "privacy-processor",
      createdAt: new Date(Date.UTC(2026, 0, 2)),
    });

    const response = await api.get(createBody.request.publicId);
    const body = await response.json();
    const serialized = JSON.stringify(body);

    expect(response.status).toBe(200);
    expect(body.request).toEqual({
      publicId: createBody.request.publicId,
      type: "DATA_ACCESS",
      status: "PENDING_VERIFICATION",
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      publicComments: [
        {
          body: "Your request is being processed.",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    expect(serialized).not.toContain(request.id);
    expect(serialized).not.toContain("requesterId");
    expect(serialized).not.toContain("john@example.com");
    expect(serialized).not.toContain("emailEncrypted");
    expect(serialized).not.toContain("emailHash");
    expect(serialized).not.toContain("phoneEncrypted");
    expect(serialized).not.toContain("phoneHash");
    expect(serialized).not.toContain("Internal reviewer note.");
    expect(serialized).not.toContain("attachments");
    expect(serialized).not.toContain("communications");
    expect(serialized).not.toContain("events");
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain("actorId");
  });

  test("public tracking returns 404 for an unknown public id", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.get("req_missing");
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  test("access-link endpoint returns generic success for an existing request", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);
    const createResponse = await api.create(publicRequest());
    const createBody = await createResponse.json();

    const response = await api.requestAccessLink(createBody.request.publicId);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      message: "If the request exists, an access link will be sent.",
    });
    expect(dependencies.state.accessTokens).toHaveLength(1);
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "CONSUMER_ACCESS_LINK_SENT",
          actorType: "SYSTEM",
          actorId: "consumer-access-link",
        }),
      ]),
    );
  });

  test("access-link endpoint returns generic success for an unknown request", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);

    const response = await api.requestAccessLink("req_missing");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      message: "If the request exists, an access link will be sent.",
    });
    expect(dependencies.state.accessTokens).toHaveLength(0);
    expect(dependencies.state.sentEmails).toHaveLength(0);
  });

  test("stores only the hashed access token", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);
    const createResponse = await api.create(publicRequest());
    const createBody = await createResponse.json();

    await api.requestAccessLink(createBody.request.publicId);
    const token = extractTokenFromEmail(dependencies.state.sentEmails.at(-1));

    expect(dependencies.state.accessTokens[0]?.tokenHash).not.toBe(token);
    expect(dependencies.state.accessTokens[0]?.tokenHash).toBe(
      hashAccessToken(token),
    );
  });

  test("access-link email includes the secure access link", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);
    const createResponse = await api.create(publicRequest());
    const createBody = await createResponse.json();

    await api.requestAccessLink(createBody.request.publicId);

    expect(dependencies.state.sentEmails.at(-1)).toEqual(
      expect.objectContaining({
        to: "john@example.com",
        subject: `MagicTrust secure access link: ${createBody.request.publicId}`,
        body: expect.stringContaining(
          `https://magictrust.test/requests/${createBody.request.publicId}/access?token=`,
        ),
      }),
    );
  });

  test("valid access token creates session for secure page", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);
    const createResponse = await api.create(publicRequest());
    const createBody = await createResponse.json();
    await api.requestAccessLink(createBody.request.publicId);
    const token = extractTokenFromEmail(dependencies.state.sentEmails.at(-1));

    const session = await exchangeConsumerAccessTokenForSession(
      dependencies,
      createBody.request.publicId,
      token,
    );

    expect(session).toEqual({
      sessionToken: expect.any(String),
      expiresAt: new Date(Date.UTC(2026, 0, 1, 0, 30)),
    });
    expect(dependencies.state.accessSessions).toHaveLength(1);
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "CONSUMER_ACCESS_TOKEN_USED",
          actorType: "CONSUMER",
          actorId: null,
        }),
        expect.objectContaining({
          type: "CONSUMER_ACCESS_SESSION_CREATED",
          actorType: "CONSUMER",
          actorId: null,
        }),
      ]),
    );
  });

  test("access token is single-use", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);
    const createResponse = await api.create(publicRequest());
    const createBody = await createResponse.json();
    await api.requestAccessLink(createBody.request.publicId);
    const token = extractTokenFromEmail(dependencies.state.sentEmails.at(-1));

    await exchangeConsumerAccessTokenForSession(
      dependencies,
      createBody.request.publicId,
      token,
    );

    await expect(
      exchangeConsumerAccessTokenForSession(
        dependencies,
        createBody.request.publicId,
        token,
      ),
    ).resolves.toBeNull();
  });

  test("session token is stored hashed, not raw", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);
    const createResponse = await api.create(publicRequest());
    const createBody = await createResponse.json();
    await api.requestAccessLink(createBody.request.publicId);
    const token = extractTokenFromEmail(dependencies.state.sentEmails.at(-1));

    const session = await exchangeConsumerAccessTokenForSession(
      dependencies,
      createBody.request.publicId,
      token,
    );

    expect(dependencies.state.accessSessions[0]?.sessionHash).not.toBe(
      session?.sessionToken,
    );
    expect(dependencies.state.accessSessions[0]?.sessionHash).toBe(
      hashAccessSession(session?.sessionToken ?? ""),
    );
  });

  test("secure page requires valid session", async () => {
    const dependencies = createInMemoryDependencies();

    await expect(
      getPublicSecureAccessData(dependencies, "req_missing", "bad-session"),
    ).resolves.toBeNull();
  });

  test("expired session is rejected", async () => {
    const { createBody, dependencies, session } =
      await createSecureSessionFixture();
    dependencies.state.accessSessions[0]!.expiresAt = new Date(
      Date.UTC(2025, 0, 1),
    );

    await expect(
      getPublicSecureAccessData(
        dependencies,
        createBody.request.publicId,
        session.sessionToken,
      ),
    ).resolves.toBeNull();
  });

  test("revoked session is rejected", async () => {
    const { createBody, dependencies, session } =
      await createSecureSessionFixture();
    dependencies.state.accessSessions[0]!.revokedAt = new Date(
      Date.UTC(2026, 0, 1),
    );

    await expect(
      getPublicSecureAccessData(
        dependencies,
        createBody.request.publicId,
        session.sessionToken,
      ),
    ).resolves.toBeNull();
  });

  test("secure page creates CONSUMER_ACCESS_SESSION_USED event", async () => {
    const { createBody, dependencies, session } =
      await createSecureSessionFixture();

    await getPublicSecureAccessData(
      dependencies,
      createBody.request.publicId,
      session.sessionToken,
    );

    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          privacyRequestId: dependencies.state.requests[0].id,
          type: "CONSUMER_ACCESS_SESSION_USED",
          actorType: "CONSUMER",
          actorId: null,
        }),
      ]),
    );
  });

  test("secure page shows verified data for a valid session", async () => {
    const dependencies = createInMemoryDependencies();
    const api = createPublicRequestApi(dependencies);
    const createResponse = await api.create(publicRequest());
    const createBody = await createResponse.json();
    const request = dependencies.state.requests[0];
    dependencies.state.comments.push(
      {
        id: "comment-public",
        requestId: request.id,
        visibility: "PUBLIC",
        body: "Your request is being processed.",
        actorType: "API_CLIENT",
        actorId: "privacy-processor",
        createdAt: new Date(Date.UTC(2026, 0, 2)),
      },
      {
        id: "comment-internal",
        requestId: request.id,
        visibility: "INTERNAL",
        body: "Internal reviewer note.",
        actorType: "INTERNAL_USER",
        actorId: "reviewer-1",
        createdAt: new Date(Date.UTC(2026, 0, 2)),
      },
    );
    dependencies.state.attachments.push({
      id: "attachment-1",
      requestId: request.id,
      visibility: "PUBLIC",
      fileName: "data-export.json",
      mimeType: "application/json",
      sizeBytes: 123,
      storageProvider: "vercel_blob",
      storageKey: "requests/req_test/attachments/file.json",
      checksum: "sha256-placeholder",
      actorType: "API_CLIENT",
      actorId: "privacy-processor",
      createdAt: new Date(Date.UTC(2026, 0, 2)),
    });
    await api.requestAccessLink(createBody.request.publicId);
    const token = extractTokenFromEmail(dependencies.state.sentEmails.at(-1));
    const session = await exchangeConsumerAccessTokenForSession(
      dependencies,
      createBody.request.publicId,
      token,
    );

    const access = await getPublicSecureAccessData(
      dependencies,
      createBody.request.publicId,
      session?.sessionToken,
    );
    const html = renderToStaticMarkup(
      createElement(PublicSecureAccessView, {
        publicId: createBody.request.publicId,
        access,
      }),
    );
    const serialized = JSON.stringify(access) + html;

    expect(access).toMatchObject({
      publicId: createBody.request.publicId,
      secureAccessVerified: true,
      publicComments: [
        {
          body: "Your request is being processed.",
          createdAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    expect(html).toContain("Secure access verified");
    expect(serialized).not.toContain(request.id);
    expect(serialized).not.toContain("requesterId");
    expect(serialized).not.toContain("john@example.com");
    expect(serialized).not.toContain("+13055551234");
    expect(serialized).not.toContain("emailEncrypted");
    expect(serialized).not.toContain("emailHash");
    expect(serialized).not.toContain("phoneEncrypted");
    expect(serialized).not.toContain("phoneHash");
    expect(serialized).not.toContain("Internal reviewer note.");
    expect(serialized).not.toContain("communications");
    expect(serialized).not.toContain("storageKey");
  });

  test("secure page lists PUBLIC attachments only", async () => {
    const { createBody, dependencies, session } =
      await createSecureSessionFixture();
    const request = dependencies.state.requests[0];
    addAttachment(dependencies, request.id, {
      id: "attachment-public",
      visibility: "PUBLIC",
      fileName: "data-export.json",
    });
    addAttachment(dependencies, request.id, {
      id: "attachment-internal",
      visibility: "INTERNAL",
      fileName: "internal-review.txt",
    });

    const access = await getPublicSecureAccessData(
      dependencies,
      createBody.request.publicId,
      session.sessionToken,
    );
    const html = renderToStaticMarkup(
      createElement(PublicSecureAccessView, {
        publicId: createBody.request.publicId,
        access,
      }),
    );
    const serialized = JSON.stringify(access) + html;

    expect(serialized).toContain("data-export.json");
    expect(serialized).toContain(
      `/requests/${createBody.request.publicId}/secure/attachments/attachment-public/download`,
    );
    expect(serialized).not.toContain("internal-review.txt");
    expect(serialized).not.toContain("storage-key-public");
    expect(serialized).not.toContain("vercel-blob");
    expect(serialized).not.toContain("sha256-test");
    expect(serialized).not.toContain("actorType");
    expect(serialized).not.toContain("actorId");
    expect(serialized).not.toContain("communications");
    expect(serialized).not.toContain(request.id);
  });

  test("consumer download requires valid secure session", async () => {
    const { createBody, dependencies } = await createSecureSessionFixture();
    const request = dependencies.state.requests[0];
    addAttachment(dependencies, request.id, {
      id: "attachment-public",
      visibility: "PUBLIC",
    });

    const response = await downloadPublicAttachmentForConsumer(
      dependencies,
      createBody.request.publicId,
      "attachment-public",
      null,
    );

    expect(response.status).toBe(404);
  });

  test("consumer download rejects expired session", async () => {
    const { createBody, dependencies, session } =
      await createSecureSessionFixture();
    const request = dependencies.state.requests[0];
    addAttachment(dependencies, request.id, {
      id: "attachment-public",
      visibility: "PUBLIC",
    });
    dependencies.state.accessSessions[0]!.expiresAt = new Date(
      Date.UTC(2025, 0, 1),
    );

    const response = await downloadPublicAttachmentForConsumer(
      dependencies,
      createBody.request.publicId,
      "attachment-public",
      session.sessionToken,
    );

    expect(response.status).toBe(404);
  });

  test("consumer download rejects revoked session", async () => {
    const { createBody, dependencies, session } =
      await createSecureSessionFixture();
    const request = dependencies.state.requests[0];
    addAttachment(dependencies, request.id, {
      id: "attachment-public",
      visibility: "PUBLIC",
    });
    dependencies.state.accessSessions[0]!.revokedAt = new Date(
      Date.UTC(2026, 0, 1),
    );

    const response = await downloadPublicAttachmentForConsumer(
      dependencies,
      createBody.request.publicId,
      "attachment-public",
      session.sessionToken,
    );

    expect(response.status).toBe(404);
  });

  test("consumer download rejects INTERNAL attachment", async () => {
    const { createBody, dependencies, session } =
      await createSecureSessionFixture();
    const request = dependencies.state.requests[0];
    addAttachment(dependencies, request.id, {
      id: "attachment-internal",
      visibility: "INTERNAL",
    });

    const response = await downloadPublicAttachmentForConsumer(
      dependencies,
      createBody.request.publicId,
      "attachment-internal",
      session.sessionToken,
    );

    expect(response.status).toBe(404);
  });

  test("consumer download rejects attachment belonging to another request", async () => {
    const { createBody, dependencies, session } =
      await createSecureSessionFixture();
    const secondApi = createPublicRequestApi(dependencies);
    await secondApi.create(publicRequest({ email: "jane@example.com" }));
    const secondRequest = dependencies.state.requests[1];
    addAttachment(dependencies, secondRequest.id, {
      id: "attachment-other",
      visibility: "PUBLIC",
    });

    const response = await downloadPublicAttachmentForConsumer(
      dependencies,
      createBody.request.publicId,
      "attachment-other",
      session.sessionToken,
    );

    expect(response.status).toBe(404);
  });

  test("successful consumer download returns file contents and creates event", async () => {
    const { createBody, dependencies, session } =
      await createSecureSessionFixture();
    const request = dependencies.state.requests[0];
    addAttachment(dependencies, request.id, {
      id: "attachment-public",
      visibility: "PUBLIC",
      fileName: "data-export.json",
      mimeType: "application/json",
      sizeBytes: 11,
    });

    const response = await downloadPublicAttachmentForConsumer(
      dependencies,
      createBody.request.publicId,
      "attachment-public",
      session.sessionToken,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="data-export.json"',
    );
    expect(await response.text()).toBe('{"ok":true}');
    expect(dependencies.state.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          privacyRequestId: request.id,
          type: "CONSUMER_ATTACHMENT_DOWNLOADED",
          actorType: "CONSUMER",
          actorId: null,
          data: expect.objectContaining({
            attachmentId: "attachment-public",
            fileName: "data-export.json",
            mimeType: "application/json",
            sizeBytes: 11,
          }),
        }),
      ]),
    );
  });
});

describe("hosted privacy request form", () => {
  test("renders the public intake form", () => {
    const html = renderToStaticMarkup(createElement(PrivacyRequestFormPage));

    expect(html).toContain("Privacy Request");
    expect(html).toContain('name="type"');
    expect(html).toContain('name="firstName"');
    expect(html).toContain('name="lastName"');
    expect(html).toContain('name="email"');
    expect(html).toContain('name="phone"');
    expect(html).toContain('name="message"');
    expect(html).toContain('name="website"');
  });

  test("confirmation includes a tracking link", () => {
    const html = renderToStaticMarkup(
      createElement(PrivacyRequestConfirmation, {
        publicId: "req_public_test",
        requestStatus: "SUBMITTED",
      }),
    );

    expect(html).toContain('href="/requests/req_public_test"');
    expect(html).toContain("Track this request");
  });

  test("submits successfully and resets the captured form", async () => {
    const resetForm = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          request: {
            publicId: "req_public_test",
            type: "DATA_ACCESS",
            status: "SUBMITTED",
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        },
        {
          status: 201,
        },
      ),
    );

    const result = await submitPrivacyRequestForm(
      validFormData(),
      "https://magictrust.test/forms/privacy-request",
      resetForm,
    );

    expect(result).toEqual({
      ok: true,
      publicId: "req_public_test",
      requestStatus: "SUBMITTED",
    });
    expect(resetForm).toHaveBeenCalledOnce();
  });

  test("does not reset the form when submission fails", async () => {
    const resetForm = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Request payload is invalid.",
          },
        },
        {
          status: 400,
        },
      ),
    );

    const result = await submitPrivacyRequestForm(
      validFormData(),
      "https://magictrust.test/forms/privacy-request",
      resetForm,
    );

    expect(result).toEqual({
      ok: false,
      message: "Request payload is invalid.",
    });
    expect(resetForm).not.toHaveBeenCalled();
  });
});

describe("public request tracking pages", () => {
  test("tracking page renders request status and public comments", () => {
    const html = renderToStaticMarkup(
      createElement(PublicRequestTrackingView, {
        publicId: "req_public_test",
        tracking: {
          publicId: "req_public_test",
          type: "DATA_ACCESS",
          status: "PROCESSING",
          createdAt: "2026-01-01T00:00:00.000Z",
          completedAt: null,
          publicComments: [
            {
              body: "Your request is being processed.",
              createdAt: "2026-01-02T00:00:00.000Z",
            },
          ],
        },
      }),
    );

    expect(html).toContain("req_public_test");
    expect(html).toContain("Data Access");
    expect(html).toContain("Processing");
    expect(html).toContain("Your request is being processed.");
    expect(html).toContain("Send me a secure access link");
  });

  test("lookup page renders a reference number form", async () => {
    const page = await PublicRequestLookupPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('action="/requests"');
    expect(html).toContain('name="publicId"');
    expect(html).toContain("Track request");
  });
});

async function createSecureSessionFixture() {
  const dependencies = createInMemoryDependencies();
  const api = createPublicRequestApi(dependencies);
  const createResponse = await api.create(publicRequest());
  const createBody = await createResponse.json();
  await api.requestAccessLink(createBody.request.publicId);
  const token = extractTokenFromEmail(dependencies.state.sentEmails.at(-1));
  const session = await exchangeConsumerAccessTokenForSession(
    dependencies,
    createBody.request.publicId,
    token,
  );

  if (!session) {
    throw new Error("Expected secure access session.");
  }

  return {
    createBody,
    dependencies,
    session,
  };
}

function validFormData() {
  const formData = new FormData();
  formData.set("type", "DATA_ACCESS");
  formData.set("firstName", "John");
  formData.set("lastName", "Doe");
  formData.set("email", "john@example.com");
  formData.set("phone", "+13055551234");
  formData.set("message", "I want to access my data.");
  formData.set("website", "");

  return formData;
}

function publicRequest(overrides: Record<string, unknown> = {}) {
  return new Request("https://magictrust.test/api/public/requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: "DATA_ACCESS",
      firstName: "John",
      lastName: "Doe",
      email: "john@example.com",
      phone: "+13055551234",
      message: "I want to access my data.",
      sourceUrl: "https://example.com/forms/privacy-request",
      website: "",
      ...overrides,
    }),
  });
}

function extractTokenFromEmail(email: { body: string } | undefined): string {
  const token = email?.body.match(/token=([A-Za-z0-9_-]+)/)?.[1];

  if (!token) {
    throw new Error("Expected secure access token in email body.");
  }

  return token;
}

function extractVerificationTokenFromEmail(
  email: { body: string } | undefined,
): string {
  const token = email?.body.match(/\/verify\?token=([A-Za-z0-9_-]+)/)?.[1];

  if (!token) {
    throw new Error("Expected identity verification token in email body.");
  }

  return token;
}

function addAttachment(
  dependencies: ReturnType<typeof createInMemoryDependencies>,
  requestId: string,
  overrides: Partial<RequestAttachment>,
) {
  dependencies.state.attachments.push({
    id: overrides.id ?? `attachment-${dependencies.state.nextId++}`,
    requestId,
    visibility: overrides.visibility ?? "PUBLIC",
    fileName: overrides.fileName ?? "data-export.json",
    mimeType: overrides.mimeType ?? "application/json",
    sizeBytes: overrides.sizeBytes ?? 11,
    storageProvider: overrides.storageProvider ?? "vercel-blob",
    storageKey: overrides.storageKey ?? "storage-key-public",
    checksum: overrides.checksum ?? "sha256-test",
    actorType: overrides.actorType ?? "API_CLIENT",
    actorId: overrides.actorId ?? "privacy-processor",
    createdAt: overrides.createdAt ?? new Date(Date.UTC(2026, 0, 2)),
  });
}

type InMemoryRequester = Requester & {
  emailEncrypted: string | null;
  emailHash: string | null;
  phoneEncrypted: string | null;
  phoneHash: string | null;
  nameEncrypted: string | null;
};

type InMemoryState = {
  nextId: number;
  requesters: InMemoryRequester[];
  requests: PrivacyRequest[];
  events: RequestEvent[];
  comments: RequestComment[];
  attachments: RequestAttachment[];
  communications: RequestCommunication[];
  accessTokens: RequestAccessToken[];
  accessSessions: RequestAccessSession[];
  identityVerificationTokens: RequestIdentityVerificationToken[];
  sentEmails: Array<{ to: string; subject: string; body: string }>;
};

function createInMemoryDependencies(
  options: {
    emailShouldFail?: boolean;
  } = {},
) {
  const state: InMemoryState = {
    nextId: 1,
    requesters: [],
    requests: [],
    events: [],
    comments: [],
    attachments: [],
    communications: [],
    accessTokens: [],
    accessSessions: [],
    identityVerificationTokens: [],
    sentEmails: [],
  };

  const requestCreationStore: RequestCreationStore = {
    async transaction(callback) {
      return callback({
        async createRequester(data: CreateRequesterRecord): Promise<Requester> {
          expect(data.emailEncrypted).toEqual(expect.any(String));
          expect(data.emailHash).toEqual(expect.any(String));

          const requester = {
            id: `requester-${state.nextId++}`,
            externalId: data.externalId,
            emailEncrypted: data.emailEncrypted,
            emailHash: data.emailHash,
            phoneEncrypted: data.phoneEncrypted,
            phoneHash: data.phoneHash,
            nameEncrypted: data.nameEncrypted,
          };
          state.requesters.push(requester);

          return requester;
        },
        async createPrivacyRequest(
          data: CreatePrivacyRequestRecord,
        ): Promise<PrivacyRequest> {
          const request = {
            id: `request-${state.nextId++}`,
            createdAt: new Date(Date.UTC(2026, 0, 1)),
            updatedAt: new Date(Date.UTC(2026, 0, 1)),
            completedAt: null,
            ...data,
          };
          state.requests.push(request);

          return request;
        },
        async createRequestEvent(
          data: CreateRequestEventRecord,
        ): Promise<RequestEvent> {
          const event = {
            id: `event-${state.nextId++}`,
            createdAt: new Date(Date.UTC(2026, 0, 1)),
            ...data,
          };
          state.events.push(event);

          return event;
        },
      });
    },
  };

  const requestRepository: RequestRepository = {
    async findByIdOrPublicId(id): Promise<RequestDetails | null> {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      return {
        ...summaryFromRequest(request),
        events: state.events
          .filter((event) => event.privacyRequestId === request.id)
          .map((event) => ({
            id: event.id,
            privacyRequestId: event.privacyRequestId,
            type: event.type,
            actorType: event.actorType,
            actorId: event.actorId,
            data: event.data,
            createdAt: event.createdAt,
          })),
        comments: state.comments.filter(
          (comment) => comment.requestId === request.id,
        ),
        attachments: state.attachments.filter(
          (attachment) => attachment.requestId === request.id,
        ),
        communications: state.communications.filter(
          (communication) => communication.requestId === request.id,
        ),
      };
    },
    async findConsumerAccessLinkTarget(publicId) {
      const request = state.requests.find((item) => item.publicId === publicId);

      if (!request) {
        return null;
      }

      const requester = state.requesters.find(
        (item) => item.id === request.requesterId,
      );

      return {
        ...summaryFromRequest(request),
        requesterEmailEncrypted: requester?.emailEncrypted ?? null,
      };
    },
    async list(filters: RequestListFilters): Promise<RequestSummary[]> {
      return state.requests
        .filter((request) =>
          filters.status ? request.status === filters.status : true,
        )
        .filter((request) =>
          filters.type ? request.type === filters.type : true,
        )
        .slice(0, filters.limit)
        .map(summaryFromRequest);
    },
    async updateStatus() {
      throw new Error("Not implemented in public intake tests.");
    },
    async addComment() {
      throw new Error("Not implemented in public intake tests.");
    },
    async addAttachment() {
      throw new Error("Not implemented in public intake tests.");
    },
    async recordAttachmentDownloaded() {
      throw new Error("Not implemented in public intake tests.");
    },
    async createCommunication(id, input) {
      const request = state.requests.find(
        (item) => item.id === id || item.publicId === id,
      );

      if (!request) {
        return null;
      }

      const communication: RequestCommunication = {
        id: `communication-${state.nextId++}`,
        requestId: request.id,
        channel: "EMAIL",
        direction: "OUTBOUND",
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        provider: input.provider,
        providerMessageId: null,
        status: "PENDING",
        errorMessage: null,
        actorType: input.actorType,
        actorId: input.actorId,
        createdAt: new Date(Date.UTC(2026, 0, 1)),
        sentAt: null,
      };
      state.communications.push(communication);

      return communication;
    },
    async markCommunicationSent(requestId, communicationId, input) {
      const communication = state.communications.find(
        (item) => item.requestId === requestId && item.id === communicationId,
      );

      if (!communication) {
        return null;
      }

      communication.status = "SENT";
      communication.providerMessageId = input.providerMessageId;
      communication.errorMessage = null;
      communication.sentAt = new Date(Date.UTC(2026, 0, 1));
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "EMAIL_SENT",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          communicationId,
          provider: communication.provider,
          providerMessageId: input.providerMessageId,
          status: "SENT",
        },
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      });

      return communication;
    },
    async markCommunicationFailed(requestId, communicationId, input) {
      const communication = state.communications.find(
        (item) => item.requestId === requestId && item.id === communicationId,
      );

      if (!communication) {
        return null;
      }

      communication.status = "FAILED";
      communication.errorMessage = input.errorMessage;
      communication.sentAt = null;
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "EMAIL_FAILED",
        actorType: input.actorType,
        actorId: input.actorId,
        data: {
          communicationId,
          provider: communication.provider,
          status: "FAILED",
          errorMessage: input.errorMessage,
        },
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      });

      return communication;
    },
    async createConsumerAccessToken(publicId, input) {
      const request = state.requests.find((item) => item.publicId === publicId);

      if (!request) {
        return null;
      }

      const accessToken: RequestAccessToken = {
        id: `access-token-${state.nextId++}`,
        requestId: request.id,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      };
      const communication: RequestCommunication = {
        id: `communication-${state.nextId++}`,
        requestId: request.id,
        channel: "EMAIL",
        direction: "OUTBOUND",
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
        provider: input.provider,
        providerMessageId: null,
        status: "PENDING",
        errorMessage: null,
        actorType: "SYSTEM",
        actorId: "consumer-access-link",
        createdAt: new Date(Date.UTC(2026, 0, 1)),
        sentAt: null,
      };
      state.accessTokens.push(accessToken);
      state.communications.push(communication);

      return {
        request: summaryFromRequest(request),
        accessToken,
        communication,
      };
    },
    async recordConsumerAccessLinkSent(requestId, input) {
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "CONSUMER_ACCESS_LINK_SENT",
        actorType: "SYSTEM",
        actorId: "consumer-access-link",
        data: {
          accessTokenId: input.accessTokenId,
          communicationId: input.communicationId,
          provider: input.provider,
          providerMessageId: input.providerMessageId,
        },
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      });
    },
    async consumeConsumerAccessToken(publicId, input) {
      const request = state.requests.find((item) => item.publicId === publicId);

      if (!request) {
        return null;
      }

      const accessToken = state.accessTokens.find(
        (item) =>
          item.requestId === request.id &&
          item.tokenHash === input.tokenHash &&
          !item.usedAt &&
          item.expiresAt > input.now,
      );

      if (!accessToken) {
        return null;
      }

      accessToken.usedAt = input.now;
      const accessSession: RequestAccessSession = {
        id: `access-session-${state.nextId++}`,
        requestId: request.id,
        sessionHash: input.sessionHash,
        expiresAt: input.sessionExpiresAt,
        revokedAt: null,
        createdAt: new Date(Date.UTC(2026, 0, 1)),
        lastSeenAt: input.now,
      };
      state.accessSessions.push(accessSession);
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: request.id,
        type: "CONSUMER_ACCESS_TOKEN_USED",
        actorType: "CONSUMER",
        actorId: null,
        data: {
          accessTokenId: accessToken.id,
        },
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      });
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: request.id,
        type: "CONSUMER_ACCESS_SESSION_CREATED",
        actorType: "CONSUMER",
        actorId: null,
        data: {
          accessTokenId: accessToken.id,
          accessSessionId: accessSession.id,
        },
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      });

      return {
        request: summaryFromRequest(request),
        accessToken,
        accessSession,
      };
    },
    async validateConsumerAccessSession(publicId, input) {
      const request = state.requests.find((item) => item.publicId === publicId);

      if (!request) {
        return null;
      }

      const accessSession = state.accessSessions.find(
        (item) =>
          item.requestId === request.id &&
          item.sessionHash === input.sessionHash &&
          !item.revokedAt &&
          item.expiresAt > input.now,
      );

      if (!accessSession) {
        return null;
      }

      accessSession.lastSeenAt = input.now;
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: request.id,
        type: "CONSUMER_ACCESS_SESSION_USED",
        actorType: "CONSUMER",
        actorId: null,
        data: {
          accessSessionId: accessSession.id,
        },
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      });

      return {
        ...summaryFromRequest(request),
        comments: state.comments.filter(
          (comment) => comment.requestId === request.id,
        ),
        attachments: state.attachments.filter(
          (attachment) =>
            attachment.requestId === request.id &&
            attachment.visibility === "PUBLIC",
        ),
      };
    },
    async recordConsumerAttachmentDownloaded(requestId, input) {
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "CONSUMER_ATTACHMENT_DOWNLOADED",
        actorType: "CONSUMER",
        actorId: null,
        data: {
          attachmentId: input.attachmentId,
          fileName: input.fileName,
          mimeType: input.mimeType,
          sizeBytes: input.sizeBytes,
        },
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      });
    },
    async createIdentityVerificationToken(requestId, input) {
      const request = state.requests.find((item) => item.id === requestId);

      if (!request) {
        return null;
      }

      const verificationToken: RequestIdentityVerificationToken = {
        id: `identity-token-${state.nextId++}`,
        requestId,
        tokenHash: input.tokenHash,
        expiresAt: input.expiresAt,
        usedAt: null,
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      };
      state.identityVerificationTokens.push(verificationToken);

      return verificationToken;
    },
    async recordIdentityVerificationSent(requestId, input) {
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: requestId,
        type: "IDENTITY_VERIFICATION_SENT",
        actorType: "SYSTEM",
        actorId: "public-intake",
        data: {
          verificationTokenId: input.verificationTokenId,
          communicationId: input.communicationId,
          provider: input.provider,
          providerMessageId: input.providerMessageId,
        },
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      });
    },
    async verifyIdentityToken(publicId, input) {
      const request = state.requests.find((item) => item.publicId === publicId);

      if (!request) {
        return null;
      }

      const verificationToken = state.identityVerificationTokens.find(
        (item) =>
          item.requestId === request.id &&
          item.tokenHash === input.tokenHash &&
          !item.usedAt &&
          item.expiresAt > input.now,
      );

      if (!verificationToken || request.status !== "PENDING_VERIFICATION") {
        return null;
      }

      verificationToken.usedAt = input.now;
      request.status = "VERIFIED";
      request.updatedAt = input.now;
      state.events.push({
        id: `event-${state.nextId++}`,
        privacyRequestId: request.id,
        type: "IDENTITY_VERIFIED",
        actorType: "CONSUMER",
        actorId: null,
        data: {
          verificationTokenId: verificationToken.id,
        },
        createdAt: new Date(Date.UTC(2026, 0, 1)),
      });

      return summaryFromRequest(request);
    },
  };

  const storageProvider: PrivateFileStorageProvider = {
    provider: "vercel-blob",
    async uploadPrivateFile(input) {
      return {
        provider: "vercel-blob",
        storageKey: input.storageKey,
        checksum: "sha256-test",
      };
    },
    async downloadPrivateFile() {
      return {
        body: new Blob(['{"ok":true}'], {
          type: "application/json",
        }).stream(),
        contentType: "application/json",
        sizeBytes: 11,
      };
    },
  };

  const emailProvider: EmailProvider = {
    provider: "resend",
    async sendEmail(input) {
      if (options.emailShouldFail) {
        throw new Error("Email provider failed to send the message.");
      }

      state.sentEmails.push(input);

      return {
        provider: "resend",
        providerMessageId: "receipt-message-1",
      };
    },
  };

  return {
    state,
    requestCreationStore,
    requestRepository,
    emailProvider,
    storageProvider,
    appBaseUrl: "https://magictrust.test",
    now: () => new Date(Date.UTC(2026, 0, 1)),
  };
}

function summaryFromRequest(request: PrivacyRequest): RequestSummary {
  return {
    id: request.id,
    publicId: request.publicId,
    requesterId: request.requesterId,
    type: request.type,
    status: request.status,
    completedAt: request.completedAt,
    createdAt: request.createdAt,
    updatedAt: request.updatedAt,
  };
}
