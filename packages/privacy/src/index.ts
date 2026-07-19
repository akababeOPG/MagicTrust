import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";

import { getEncryptionKey } from "@magictrust/config";
import { compare, hash } from "bcryptjs";

const encryptionVersion = "v1";
const ivByteLength = 12;
const adminPasswordHashRounds = 12;
const dummyAdminPasswordHash =
  "$2b$12$dieMoFrnLujk6rV1aHcdaO.3RW7NlU4HQvya4y.OGn2C8P9hy9Iuq";

export const adminPasswordMinLength = 10;
export const adminPasswordMaxBytes = 72;

export async function hashAdminPassword(password: string): Promise<string> {
  assertAdminPasswordLength(password);

  return hash(password, adminPasswordHashRounds);
}

export async function verifyAdminPassword(
  password: string,
  passwordHash: string | null,
): Promise<boolean> {
  const usableHash = isBcryptHash(passwordHash)
    ? passwordHash
    : dummyAdminPasswordHash;

  try {
    const matches = await compare(password, usableHash);

    return passwordHash !== null && usableHash === passwordHash && matches;
  } catch {
    return false;
  }
}

export function encryptPii(value: string): string {
  const iv = randomBytes(ivByteLength);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("encrypt"), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    encryptionVersion,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptPii(value: string): string {
  const [version, iv, authTag, ciphertext] = value.split(":");

  if (version !== encryptionVersion || !iv || !authTag || !ciphertext) {
    throw new Error("Encrypted PII value has an unsupported format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey("encrypt"),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function hashPii(value: string): string {
  return createHmac("sha256", deriveKey("hash"))
    .update(normalizePiiForHash(value))
    .digest("hex");
}

export function encryptSubmittedPayload(value: unknown): string {
  return encryptPii(stableStringify(value));
}

export function decryptSubmittedPayload(value: string): unknown {
  return JSON.parse(decryptPii(value));
}

export function hashSubmittedPayload(value: unknown): string {
  return createHmac("sha256", deriveKey("submitted-payload"))
    .update(stableStringify(value))
    .digest("hex");
}

export function hashAccessToken(value: string): string {
  return createHmac("sha256", deriveKey("access-token"))
    .update(value)
    .digest("hex");
}

export function hashAccessSession(value: string): string {
  return createHmac("sha256", deriveKey("access-session"))
    .update(value)
    .digest("hex");
}

export function hashIdentityVerificationToken(value: string): string {
  return createHmac("sha256", deriveKey("identity-verification"))
    .update(value)
    .digest("hex");
}

export function hashAdminLoginToken(value: string): string {
  return createHmac("sha256", deriveKey("admin-login"))
    .update(value)
    .digest("hex");
}

export function hashAdminSessionToken(value: string): string {
  return createHmac("sha256", deriveKey("admin-session"))
    .update(value)
    .digest("hex");
}

export function normalizeEmailForHash(value: string): string {
  return value.trim().toLowerCase();
}

export function hashEmail(value: string): string {
  return hashPii(normalizeEmailForHash(value));
}

export function prepareProtectedEmail(value: string): {
  normalizedEmail: string;
  emailEncrypted: string;
  emailHash: string;
} {
  const normalizedEmail = normalizeEmailForHash(value);

  return {
    normalizedEmail,
    emailEncrypted: encryptPii(normalizedEmail),
    emailHash: hashEmail(normalizedEmail),
  };
}

export function normalizePhoneForHash(value: string): string {
  return value.trim().replace(/[\s\-()]/g, "");
}

function normalizePiiForHash(value: string): string {
  return value.includes("@")
    ? normalizeEmailForHash(value)
    : normalizePhoneForHash(value);
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function deriveKey(
  purpose:
    | "encrypt"
    | "hash"
    | "submitted-payload"
    | "access-token"
    | "access-session"
    | "identity-verification"
    | "admin-login"
    | "admin-session",
): Buffer {
  const encryptionKey = getEncryptionKey();

  if (!encryptionKey) {
    throw new Error("ENCRYPTION_KEY is required for PII protection.");
  }

  return createHash("sha256")
    .update(`magictrust:pii:${purpose}:`)
    .update(encryptionKey)
    .digest();
}

function assertAdminPasswordLength(password: string): void {
  if (password.length < adminPasswordMinLength) {
    throw new Error("Admin password must be at least 10 characters.");
  }

  if (Buffer.byteLength(password, "utf8") > adminPasswordMaxBytes) {
    throw new Error("Admin password must be at most 72 bytes.");
  }
}

function isBcryptHash(value: string | null): value is string {
  return Boolean(value && /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/.test(value));
}
