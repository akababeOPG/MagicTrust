import { describe, expect, test } from "vitest";

import {
  decryptPii,
  encryptPii,
  hashPii,
  normalizeEmailForHash,
  normalizePhoneForHash,
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

  test("phone normalization produces the same hash for formatting variants", () => {
    expect(hashPii(normalizePhoneForHash(" (305) 555-1234 "))).toBe(
      hashPii(normalizePhoneForHash("3055551234")),
    );
  });
});
