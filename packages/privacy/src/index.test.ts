import { describe, expect, test } from "vitest";

import {
  decryptPii,
  encryptPii,
  hashEmail,
  hashPii,
  normalizeEmailForHash,
  normalizePhoneForHash,
  prepareProtectedEmail,
} from "./index";

process.env.ENCRYPTION_KEY = "test-encryption-key-for-privacy-package";

describe("PII crypto utilities", () => {
  test("encrypts and decrypts a value", () => {
    const encrypted = encryptPii("john@example.com");

    expect(decryptPii(encrypted)).toBe("john@example.com");
  });

  test("encrypted value is not equal to the raw value", () => {
    const encrypted = encryptPii("john@example.com");

    expect(encrypted).not.toBe("john@example.com");
  });

  test("same email produces same hash after normalization", () => {
    expect(hashPii(normalizeEmailForHash("  JOHN@example.com  "))).toBe(
      hashPii(normalizeEmailForHash("john@example.com")),
    );
  });

  test("prepares encrypted email storage and lookup data canonically", () => {
    const prepared = prepareProtectedEmail("  USER@OnPointGlobal.com  ");

    expect(prepared.normalizedEmail).toBe("user@onpointglobal.com");
    expect(decryptPii(prepared.emailEncrypted)).toBe("user@onpointglobal.com");
    expect(prepared.emailHash).toBe(hashEmail("user@onpointglobal.com"));
  });

  test("phone normalization produces the same hash for formatting variants", () => {
    expect(hashPii(normalizePhoneForHash(" (305) 555-1234 "))).toBe(
      hashPii(normalizePhoneForHash("3055551234")),
    );
  });
});
