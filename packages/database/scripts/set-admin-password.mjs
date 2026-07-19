import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";

import { Pool } from "@neondatabase/serverless";
import { hashAdminPassword, hashEmail } from "../../privacy/src/index.ts";

const rootDirectory = findWorkspaceRoot(process.cwd());
const localEnvPath = join(rootDirectory, ".env.local");

if (existsSync(localEnvPath)) {
  loadEnvFile(localEnvPath);
}

const args = parseArgs(process.argv.slice(2));
const email = args.email ?? "";
const password = process.env.ADMIN_BOOTSTRAP_PASSWORD ?? "";

if (!email.trim()) {
  console.error(
    'Usage: pnpm admin:user:set-password --email "user@onpointglobal.com"',
  );
  process.exit(1);
}

if (!process.env.ENCRYPTION_KEY) {
  console.error("ENCRYPTION_KEY is required to locate the admin user.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required in the root .env.local file.");
  process.exit(1);
}

if (!password) {
  console.error(
    "ADMIN_BOOTSTRAP_PASSWORD is required to set an admin password.",
  );
  process.exit(1);
}

let passwordHash;

try {
  passwordHash = await hashAdminPassword(password);
} catch {
  console.error(
    "ADMIN_BOOTSTRAP_PASSWORD must be at least 10 characters and at most 72 bytes.",
  );
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const client = await pool.connect();

try {
  const result = await client.query(
    `update admin_users
     set password_hash = $1, updated_at = now()
     where email_hash = $2`,
    [passwordHash, hashEmail(email)],
  );

  if (result.rowCount === 0) {
    console.error("Admin user was not found.");
    process.exitCode = 1;
  } else {
    console.log("Admin password updated.");
  }
} finally {
  client.release();
  await pool.end();
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--email") {
      parsed.email = values[index + 1];
      index += 1;
    }
  }

  return parsed;
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
