import type { PublicSecureAccessData } from "../../lib/public-request-api";
import { PublicSecureAccessView } from "../../lib/public-secure-access-view";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

describe("public secure access view", () => {
  test("prioritizes a completed DATA_ACCESS response and keeps its secure route", () => {
    const html = renderSecureAccess({
      status: "SUCCESS",
      completedAt: "2026-07-18T12:00:00.000Z",
      publicAttachments: [
        responseFile({
          fileName: "data-export.json",
          mimeType: "application/json",
          sizeBytes: 167_936,
        }),
      ],
    });

    expect(html).toContain("Your response is ready");
    expect(html).toContain("Completed");
    expect(html).toContain("Your response");
    expect(html).toContain("Download response");
    expect(html).toContain("JSON file");
    expect(html).toContain("164 KB");
    expect(html).not.toContain("application/json");
    expect(html.indexOf("Your response</h2>")).toBeLessThan(
      html.indexOf("Request details</h2>"),
    );
    expect(html).toContain(
      'href="/requests/req_public_test/secure/attachments/attachment-1/download"',
    );
  });

  test("renders a download action for every PUBLIC response file", () => {
    const html = renderSecureAccess({
      status: "SUCCESS",
      completedAt: "2026-07-18T12:00:00.000Z",
      publicAttachments: [
        responseFile({
          id: "attachment-pdf",
          fileName: "response.pdf",
          mimeType: "application/pdf",
          downloadUrl:
            "/requests/req_public_test/secure/attachments/attachment-pdf/download",
        }),
        responseFile({
          id: "attachment-zip",
          fileName: "supporting-files.zip",
          mimeType: "application/zip",
          downloadUrl:
            "/requests/req_public_test/secure/attachments/attachment-zip/download",
        }),
      ],
    });

    expect(html).toContain("Your response files");
    expect(html).toContain("PDF document");
    expect(html).toContain("ZIP archive");
    expect(html).toContain('aria-label="Download response.pdf"');
    expect(html).toContain('aria-label="Download supporting-files.zip"');
    expect(html.match(/>Download<\/a>/g)).toHaveLength(2);
  });

  test("treats public response files as a generic request capability", () => {
    const html = renderSecureAccess({
      type: "GENERAL_INQUIRY",
      status: "SUCCESS",
      completedAt: "2026-07-18T12:00:00.000Z",
      publicAttachments: [responseFile()],
    });

    expect(html).toContain("Your response is ready");
    expect(html).toContain("Download response");
    expect(html).not.toContain("data access request");
  });

  test("renders DATA_DELETION completion copy without an empty files section", () => {
    const html = renderSecureAccess({
      type: "DATA_DELETION",
      status: "SUCCESS",
      completedAt: "2026-07-18T12:00:00.000Z",
      publicAttachments: [],
    });

    expect(html).toContain("Your deletion request is complete");
    expect(html).toContain("Your data deletion request has been completed.");
    expect(html).not.toContain("Your response</h2>");
    expect(html).not.toContain("Your response files");
  });

  test("renders secure public files for a completed DATA_DELETION request", () => {
    const html = renderSecureAccess({
      type: "DATA_DELETION",
      status: "SUCCESS",
      completedAt: "2026-07-18T12:00:00.000Z",
      publicAttachments: [responseFile()],
    });

    expect(html).toContain("Your deletion request is complete");
    expect(html).toContain("Download response");
    expect(html).not.toContain("storageKey");
    expect(html).not.toContain("assignment");
    expect(html).not.toContain("dueAt");
  });

  test.each([
    ["PROCESSING", "Your deletion request is being processed"],
    ["PENDING_VERIFICATION", "Verification required"],
    ["VERIFIED", "Your request is ready for processing"],
    ["REJECTED", "Your deletion request could not be completed"],
    ["CANCELLED", "Your deletion request was cancelled"],
  ] as const)("renders DATA_DELETION %s copy", (status, title) => {
    const html = renderSecureAccess({ type: "DATA_DELETION", status });
    expect(html).toContain(title);
  });

  test("hides empty updates and empty response UI while processing", () => {
    const html = renderSecureAccess({
      status: "PROCESSING",
      publicAttachments: [],
      publicComments: [],
      publicEvents: [],
    });

    expect(html).toContain("Your request is being processed");
    expect(html).toContain("In progress");
    expect(html).not.toContain("Your response</h2>");
    expect(html).not.toContain("Your response files");
    expect(html).not.toContain("No public attachments");
    expect(html).not.toContain("Public Comments");
    expect(html).not.toContain("No public comments yet");
    expect(html).not.toContain("Public Updates");
    expect(html).not.toContain("No public updates yet");
    expect(html).not.toContain("Updates</h2>");
  });

  test("combines public comments and events using natural language", () => {
    const html = renderSecureAccess({
      status: "WAITING_FOR_REQUESTER",
      publicComments: [
        {
          body: "Please confirm the date range for your request.",
          createdAt: "2026-07-17T12:00:00.000Z",
        },
      ],
      publicEvents: [
        {
          type: "RESPONSE_REVIEW_STARTED",
          data: { internalSystem: "must-not-render" },
          createdAt: "2026-07-18T12:00:00.000Z",
        },
      ],
    });

    expect(html).toContain("We need more information");
    expect(html).toContain("Waiting on you");
    expect(html).toContain("Updates");
    expect(html).toContain("Message from MagicTrust");
    expect(html).toContain("Response review started");
    expect(html).not.toContain("RESPONSE_REVIEW_STARTED");
    expect(html).not.toContain("internalSystem");
    expect(html).not.toContain("must-not-render");
    expect(html).not.toContain("<pre");
  });

  test("does not render sensitive storage or authentication fields", () => {
    const access = {
      ...secureAccess(),
      publicAttachments: [
        {
          ...responseFile(),
          storageKey: "private-storage-key",
          storageProvider: "vercel-blob",
        },
      ],
      sessionId: "private-session-id",
      accessToken: "private-access-token",
      requesterEmail: "private@example.com",
    } as unknown as PublicSecureAccessData;
    const html = renderToStaticMarkup(
      <PublicSecureAccessView publicId={access.publicId} access={access} />,
    );

    expect(html).not.toContain("private-storage-key");
    expect(html).not.toContain("vercel-blob");
    expect(html).not.toContain("private-session-id");
    expect(html).not.toContain("private-access-token");
    expect(html).not.toContain("private@example.com");
  });
});

function renderSecureAccess(
  overrides: Partial<PublicSecureAccessData> = {},
): string {
  const access = secureAccess(overrides);
  return renderToStaticMarkup(
    <PublicSecureAccessView publicId={access.publicId} access={access} />,
  );
}

function secureAccess(
  overrides: Partial<PublicSecureAccessData> = {},
): PublicSecureAccessData {
  return {
    publicId: "req_public_test",
    type: "DATA_ACCESS",
    status: "VERIFIED",
    createdAt: "2026-07-16T12:00:00.000Z",
    completedAt: null,
    publicComments: [],
    publicEvents: [],
    publicAttachments: [],
    secureAccessVerified: true,
    ...overrides,
  };
}

function responseFile(
  overrides: Partial<PublicSecureAccessData["publicAttachments"][number]> = {},
): PublicSecureAccessData["publicAttachments"][number] {
  return {
    id: "attachment-1",
    fileName: "data-export.json",
    mimeType: "application/json",
    sizeBytes: 2_516_582,
    createdAt: "2026-07-18T12:00:00.000Z",
    downloadUrl:
      "/requests/req_public_test/secure/attachments/attachment-1/download",
    ...overrides,
  };
}
