import { decryptPii, decryptSubmittedPayload } from "@magictrust/privacy";
import { afterEach, describe, expect, test } from "vitest";

import {
  prepareLegacyCommunicationBackfill,
  prepareLegacyRequestBackfill,
} from "./pii-backfill";

const originalEncryptionKey = process.env.ENCRYPTION_KEY;

afterEach(() => {
  process.env.ENCRYPTION_KEY = originalEncryptionKey;
});

describe("PII backfill helpers", () => {
  test("backfill encrypts and sanitizes legacy request rows", () => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-backfill";
    const legacySubmittedData = {
      type: "DATA_ACCESS",
      requester: {
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "+13055551234",
      },
      source: {
        channel: "FORM",
        formKey: "privacy-request",
        siteKey: "magictrust-hosted",
        sourceUrl: "https://example.test/privacy?email=john@example.com",
      },
      submittedData: {
        message: "Please send my data",
      },
    } as const;

    const update = prepareLegacyRequestBackfill({
      id: "request-1",
      type: "DATA_ACCESS",
      submittedData: legacySubmittedData,
      submittedDataEncrypted: null,
    });

    expect(update).toMatchObject({
      id: "request-1",
      submittedData: {
        type: "DATA_ACCESS",
        source: {
          channel: "FORM",
          formKey: "privacy-request",
          siteKey: "magictrust-hosted",
        },
      },
      submittedDataHash: expect.any(String),
      encryptionVersion: 1,
    });
    expect(JSON.stringify(update?.submittedData)).not.toContain(
      "john@example.com",
    );
    expect(JSON.stringify(update?.submittedData)).not.toContain(
      "Please send my data",
    );
    expect(update?.submittedDataEncrypted).not.toContain("john@example.com");
    expect(
      decryptSubmittedPayload(update?.submittedDataEncrypted ?? ""),
    ).toEqual(legacySubmittedData);
  });

  test("backfill encrypts and clears legacy communication recipients", () => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-backfill";

    const update = prepareLegacyCommunicationBackfill({
      id: "communication-1",
      recipient: "John@Example.com",
    });

    expect(update).toMatchObject({
      id: "communication-1",
      recipient: null,
      recipientEncrypted: expect.any(String),
      recipientHash: expect.any(String),
      encryptionVersion: 1,
    });
    expect(update?.recipientEncrypted).not.toContain("John@Example.com");
    expect(decryptPii(update?.recipientEncrypted ?? "")).toBe(
      "John@Example.com",
    );
  });

  test("backfill is idempotent for already protected rows", () => {
    process.env.ENCRYPTION_KEY = "test-encryption-key-for-backfill";

    expect(
      prepareLegacyRequestBackfill({
        id: "request-1",
        type: "DATA_ACCESS",
        submittedData: {},
        submittedDataEncrypted: "already-encrypted",
      }),
    ).toBeNull();
    expect(
      prepareLegacyCommunicationBackfill({
        id: "communication-1",
        recipient: null,
      }),
    ).toBeNull();
  });

  test("dry-run style counting does not require preparing updates", () => {
    const requests = [
      { submittedDataEncrypted: null },
      { submittedDataEncrypted: "already-encrypted" },
    ];
    const communications = [
      { recipient: "john@example.com" },
      { recipient: null },
    ];

    expect(
      requests.filter((request) => request.submittedDataEncrypted === null),
    ).toHaveLength(1);
    expect(
      communications.filter(
        (communication) => communication.recipient !== null,
      ),
    ).toHaveLength(1);
  });

  test("missing ENCRYPTION_KEY aborts safely before producing updates", () => {
    delete process.env.ENCRYPTION_KEY;

    expect(() =>
      prepareLegacyCommunicationBackfill({
        id: "communication-1",
        recipient: "john@example.com",
      }),
    ).toThrow("ENCRYPTION_KEY is required for PII protection.");
  });
});
