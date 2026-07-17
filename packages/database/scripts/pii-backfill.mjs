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

const batchSize = 100;
const rootDirectory = findWorkspaceRoot(process.cwd());
const localEnvPath = join(rootDirectory, ".env.local");

if (existsSync(localEnvPath)) {
  loadEnvFile(localEnvPath);
}

const mode = parseMode(process.argv.slice(2));

if (!process.env.ENCRYPTION_KEY) {
  console.error("ENCRYPTION_KEY is required for PII backfill.");
  process.exit(1);
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required for PII backfill.");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

try {
  const counts =
    mode === "dry-run" ? await dryRun(pool) : await applyBackfill(pool);

  console.log(`Mode: ${mode}`);
  console.log(`Requests eligible: ${counts.requestsEligible}`);
  console.log(`Requests updated: ${counts.requestsUpdated}`);
  console.log(`Communications eligible: ${counts.communicationsEligible}`);
  console.log(`Communications updated: ${counts.communicationsUpdated}`);
} finally {
  await pool.end();
}

function parseMode(args) {
  if (args.includes("--apply")) {
    return "apply";
  }

  if (args.includes("--dry-run")) {
    return "dry-run";
  }

  console.error("Usage: pnpm pii:backfill --dry-run | --apply");
  process.exit(1);
}

async function dryRun(pool) {
  const requests = await pool.query(
    "select count(*)::int as count from privacy_requests where submitted_data_encrypted is null",
  );
  const communications = await pool.query(
    "select count(*)::int as count from request_communications where recipient is not null",
  );

  return {
    requestsEligible: requests.rows[0].count,
    requestsUpdated: 0,
    communicationsEligible: communications.rows[0].count,
    communicationsUpdated: 0,
  };
}

async function applyBackfill(pool) {
  let requestsEligible = 0;
  let requestsUpdated = 0;
  let communicationsEligible = 0;
  let communicationsUpdated = 0;

  while (true) {
    const { rows } = await pool.query(
      `select id, type, submitted_data
       from privacy_requests
       where submitted_data_encrypted is null
       order by created_at asc
       limit $1`,
      [batchSize],
    );

    if (rows.length === 0) {
      break;
    }

    requestsEligible += rows.length;

    for (const row of rows) {
      const submittedData = row.submitted_data ?? {};
      await pool.query(
        `update privacy_requests
         set submitted_data = $2,
             submitted_data_encrypted = $3,
             submitted_data_hash = $4,
             encryption_version = 1
         where id = $1
           and submitted_data_encrypted is null`,
        [
          row.id,
          sanitizeSubmittedDataSnapshot(submittedData, row.type),
          encryptValue(stableStringify(submittedData)),
          hashSubmittedPayload(submittedData),
        ],
      );
      requestsUpdated += 1;
    }
  }

  while (true) {
    const { rows } = await pool.query(
      `select id, recipient
       from request_communications
       where recipient is not null
       order by created_at asc
       limit $1`,
      [batchSize],
    );

    if (rows.length === 0) {
      break;
    }

    communicationsEligible += rows.length;

    for (const row of rows) {
      await pool.query(
        `update request_communications
         set recipient = null,
             recipient_encrypted = $2,
             recipient_hash = $3,
             encryption_version = 1
         where id = $1
           and recipient is not null`,
        [row.id, encryptValue(row.recipient), hashPii(row.recipient)],
      );
      communicationsUpdated += 1;
    }
  }

  return {
    requestsEligible,
    requestsUpdated,
    communicationsEligible,
    communicationsUpdated,
  };
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
  const normalized = value.includes("@")
    ? value.trim().toLowerCase()
    : value.trim().replace(/[\s\-()]/g, "");

  return createHmac("sha256", deriveKey("hash"))
    .update(normalized)
    .digest("hex");
}

function hashSubmittedPayload(value) {
  return createHmac("sha256", deriveKey("submitted-payload"))
    .update(stableStringify(value))
    .digest("hex");
}

function deriveKey(purpose) {
  return createHash("sha256")
    .update(`magictrust:pii:${purpose}:`)
    .update(process.env.ENCRYPTION_KEY)
    .digest();
}

function sanitizeSubmittedDataSnapshot(submittedData, requestType) {
  const source =
    submittedData &&
    typeof submittedData === "object" &&
    !Array.isArray(submittedData) &&
    submittedData.source &&
    typeof submittedData.source === "object" &&
    !Array.isArray(submittedData.source)
      ? submittedData.source
      : {};

  return {
    type: requestType,
    source: {
      channel: safeString(source.channel),
      formKey: safeString(source.formKey),
      siteKey: safeString(source.siteKey),
    },
  };
}

function safeString(value) {
  return typeof value === "string" && value.trim() ? value : null;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
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
