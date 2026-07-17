import {
  createCipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";

import { Pool } from "@neondatabase/serverless";

const roles = new Set(["ADMIN", "OPERATOR", "VIEWER"]);
const rootDirectory = findWorkspaceRoot(process.cwd());
const localEnvPath = join(rootDirectory, ".env.local");

if (existsSync(localEnvPath)) {
  loadEnvFile(localEnvPath);
}

const args = parseArgs(process.argv.slice(2));
const email = normalizeEmail(args.email ?? "");
const role = args.role;

if (!email || !role || !roles.has(role)) {
  console.error(
    'Usage: pnpm admin:user:create --email "user@onpointglobal.com" --role ADMIN',
  );
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  console.error("ENCRYPTION_KEY is required to create admin users.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required in the root .env.local file.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  const emailHash = hashPii(email);
  const existing = await client.query(
    "select id from admin_users where email_hash = $1 limit 1",
    [emailHash],
  );

  if (existing.rowCount && existing.rowCount > 0) {
    console.error("Admin user already exists.");
    process.exitCode = 1;
  } else {
    await client.query(
      `insert into admin_users (email_encrypted, email_hash, role)
       values ($1, $2, $3)`,
      [encryptValue(email), emailHash, role],
    );

    console.log(`Admin user created with role ${role}.`);
  }
} finally {
  client.release();
  await pool.end();
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === "--email") {
      parsed.email = values[index + 1];
      index += 1;
      continue;
    }

    if (value === "--role") {
      parsed.role = values[index + 1];
      index += 1;
    }
  }

  return parsed;
}

function normalizeEmail(value) {
  return value.trim().toLowerCase();
}

function encryptValue(value) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey("encrypt"), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();

  return [
    "v1",
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

function hashPii(value) {
  return createHmac("sha256", deriveKey("hash")).update(value).digest("hex");
}

function deriveKey(purpose) {
  return createHash("sha256")
    .update(`magictrust:pii:${purpose}:`)
    .update(process.env.ENCRYPTION_KEY)
    .digest();
}

function findWorkspaceRoot(startDirectory) {
  let currentDirectory = startDirectory;

  while (true) {
    if (existsSync(join(currentDirectory, "pnpm-workspace.yaml"))) {
      return currentDirectory;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      return startDirectory;
    }

    currentDirectory = parentDirectory;
  }
}
