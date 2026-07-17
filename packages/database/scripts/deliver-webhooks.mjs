import { createDecipheriv, createHash, createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";

import { Pool } from "@neondatabase/serverless";

const retryDelaysMs = [
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
];
const maxAttempts = 5;
const localHostnames = new Set([
  "localhost",
  "localhost.localdomain",
  "host.docker.internal",
  "127.0.0.1",
  "::1",
]);

const rootDirectory = findWorkspaceRoot(process.cwd());
const localEnvPath = join(rootDirectory, ".env.local");

if (existsSync(localEnvPath)) {
  loadEnvFile(localEnvPath);
}

const args = parseArgs(process.argv.slice(2));
const limit = parseLimit(args.limit ?? "50");
const databaseUrl = process.env.DATABASE_URL;
const encryptionKey = process.env.ENCRYPTION_KEY;

if (!databaseUrl) {
  console.error("DATABASE_URL is required in the root .env.local file.");
  process.exit(1);
}

if (!encryptionKey) {
  console.error("ENCRYPTION_KEY is required in the root .env.local file.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();
const now = new Date();
const counts = {
  claimed: 0,
  delivered: 0,
  retrying: 0,
  dead: 0,
};

try {
  const claimed = await claimDeliveries(client, { limit, now });
  counts.claimed = claimed.length;

  for (const delivery of claimed) {
    const outcome = await deliver(client, delivery, {
      now,
      encryptionKey,
    });
    counts[outcome] += 1;
  }

  console.log(`claimed=${counts.claimed}`);
  console.log(`delivered=${counts.delivered}`);
  console.log(`retrying=${counts.retrying}`);
  console.log(`dead=${counts.dead}`);
} catch {
  console.error("Webhook delivery failed.");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

async function claimDeliveries(client, input) {
  const result = await client.query(
    `with candidates as (
       select d.id
       from webhook_deliveries d
       where d.status in ('PENDING', 'RETRYING')
         and d.next_attempt_at <= $1
       order by d.created_at asc
       limit $2
       for update skip locked
     )
     update webhook_deliveries d
     set attempt_count = d.attempt_count + 1,
         last_attempt_at = $1,
         updated_at = $1
     from candidates
     where d.id = candidates.id
     returning
       d.id,
       d.event_type,
       d.payload,
       d.attempt_count,
       (select active from webhook_endpoints e where e.id = d.webhook_endpoint_id) as endpoint_active,
       (select url_encrypted from webhook_endpoints e where e.id = d.webhook_endpoint_id) as url_encrypted,
       (select signing_secret_encrypted from webhook_endpoints e where e.id = d.webhook_endpoint_id) as signing_secret_encrypted`,
    [input.now, input.limit],
  );

  return result.rows;
}

async function deliver(client, delivery, input) {
  if (!delivery.endpoint_active) {
    await markDead(client, delivery.id, input.now, null, "ENDPOINT_INACTIVE");
    return "dead";
  }

  let url;
  let signingSecret;

  try {
    url = validateDestination(
      decryptValue(delivery.url_encrypted, input.encryptionKey),
    );
    signingSecret = decryptValue(
      delivery.signing_secret_encrypted,
      input.encryptionKey,
    );
  } catch {
    await markDead(client, delivery.id, input.now, null, "UNSAFE_ENDPOINT");
    return "dead";
  }

  const body = stableStringify(delivery.payload);
  const timestamp = Math.floor(input.now.getTime() / 1000);
  const signature = `v1=${createHmac("sha256", signingSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;

  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      body,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "MagicTrust-Webhooks/1.0",
        "X-MagicTrust-Event": delivery.event_type,
        "X-MagicTrust-Delivery-Id": delivery.id,
        "X-MagicTrust-Timestamp": timestamp.toString(),
        "X-MagicTrust-Signature": signature,
      },
    });

    if (response.status >= 200 && response.status < 300) {
      await client.query(
        `update webhook_deliveries
         set status = 'DELIVERED',
             delivered_at = $2,
             response_status = $3,
             last_error_code = null,
             updated_at = $2
         where id = $1`,
        [delivery.id, input.now, response.status],
      );
      return "delivered";
    }

    if (isRetryableStatus(response.status)) {
      return retryOrDead(
        client,
        delivery,
        input.now,
        response.status,
        `HTTP_${response.status}`,
      );
    }

    await markDead(
      client,
      delivery.id,
      input.now,
      response.status,
      `HTTP_${response.status}`,
    );
    return "dead";
  } catch {
    return retryOrDead(client, delivery, input.now, null, "NETWORK_ERROR");
  }
}

async function retryOrDead(client, delivery, now, responseStatus, errorCode) {
  if (delivery.attempt_count >= maxAttempts) {
    await markDead(client, delivery.id, now, responseStatus, errorCode);
    return "dead";
  }

  const delay = retryDelaysMs[delivery.attempt_count - 1] ?? retryDelaysMs[0];
  await client.query(
    `update webhook_deliveries
     set status = 'RETRYING',
         next_attempt_at = $2,
         response_status = $3,
         last_error_code = $4,
         updated_at = $5
     where id = $1`,
    [
      delivery.id,
      new Date(now.getTime() + delay),
      responseStatus,
      errorCode,
      now,
    ],
  );
  return "retrying";
}

async function markDead(client, deliveryId, now, responseStatus, errorCode) {
  await client.query(
    `update webhook_deliveries
     set status = 'DEAD',
         response_status = $3,
         last_error_code = $4,
         updated_at = $2
     where id = $1`,
    [deliveryId, now, responseStatus, errorCode],
  );
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    if (values[index] === "--limit") {
      parsed.limit = values[index + 1];
      index += 1;
    }
  }

  return parsed;
}

function parseLimit(value) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 500) {
    console.error("--limit must be an integer from 1 to 500.");
    process.exit(1);
  }

  return parsed;
}

function decryptValue(value, encryptionKey) {
  const [version, iv, authTag, ciphertext] = value.split(":");

  if (version !== "v1" || !iv || !authTag || !ciphertext) {
    throw new Error("Encrypted value has an unsupported format.");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    deriveKey(encryptionKey),
    Buffer.from(iv, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(authTag, "base64url"));

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function deriveKey(encryptionKey) {
  return createHash("sha256")
    .update("magictrust:pii:encrypt:")
    .update(encryptionKey)
    .digest();
}

function validateDestination(rawUrl) {
  const url = new URL(rawUrl);

  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("Unsafe webhook URL.");
  }

  const hostname = url.hostname.toLowerCase();

  if (
    localHostnames.has(hostname) ||
    hostname.endsWith(".localhost") ||
    isUnsafeIpLiteral(hostname)
  ) {
    throw new Error("Unsafe webhook URL.");
  }

  return url;
}

function isRetryableStatus(status) {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );
}

function isUnsafeIpLiteral(hostname) {
  const ipVersion = isIP(hostname);

  if (ipVersion === 0) {
    return false;
  }

  if (ipVersion === 4) {
    const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
    const [first = 0, second = 0] = parts;

    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254) ||
      first === 0
    );
  }

  return (
    hostname === "::1" ||
    hostname.toLowerCase().startsWith("fc") ||
    hostname.toLowerCase().startsWith("fd") ||
    hostname.toLowerCase().startsWith("fe80")
  );
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
