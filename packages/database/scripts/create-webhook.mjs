import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { isIP } from "node:net";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";

import { Pool } from "@neondatabase/serverless";

const builtInEvents = new Set([
  "REQUEST_CREATED",
  "STATUS_CHANGED",
  "PUBLIC_COMMENT_ADDED",
  "INTERNAL_COMMENT_ADDED",
  "PUBLIC_ATTACHMENT_ADDED",
  "INTERNAL_ATTACHMENT_ADDED",
  "ATTACHMENT_DOWNLOADED",
  "ADMIN_ATTACHMENT_DOWNLOADED",
  "EMAIL_SENT",
  "EMAIL_FAILED",
  "CONSUMER_ACCESS_LINK_SENT",
  "CONSUMER_ACCESS_TOKEN_USED",
  "CONSUMER_ACCESS_SESSION_CREATED",
  "CONSUMER_ACCESS_SESSION_USED",
  "CONSUMER_ATTACHMENT_DOWNLOADED",
  "IDENTITY_VERIFICATION_SENT",
  "IDENTITY_VERIFIED",
  "CONSUMER_NOTIFICATION_SENT",
  "CONSUMER_NOTIFICATION_FAILED",
  "REQUEST_DATA_UPDATED",
]);
const reservedEvents = new Set([...builtInEvents, "CUSTOM_EVENT"]);
const customEventPattern = /^[A-Z][A-Z0-9_]{2,79}$/;
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
const name = args.name?.trim();
const events = parseEvents(args.events ?? "");

if (!name || !args.url || events.length === 0) {
  console.error(
    'Usage: pnpm webhook:create --name "Privacy Processor" --url "https://processor.example.com/webhooks/magictrust" --events "REQUEST_CREATED,STATUS_CHANGED"',
  );
  process.exit(1);
}

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

let parsedUrl;

try {
  parsedUrl = validateDestination(args.url);
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "Invalid webhook URL.",
  );
  process.exit(1);
}

const signingSecret = `whsec_${randomBytes(32).toString("base64url")}`;
const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("begin");

  const endpointResult = await client.query(
    `insert into webhook_endpoints
      (name, url_encrypted, url_host, signing_secret_encrypted)
     values ($1, $2, $3, $4)
     returning id, name, url_host`,
    [
      name,
      encryptValue(parsedUrl.toString(), encryptionKey),
      parsedUrl.hostname,
      encryptValue(signingSecret, encryptionKey),
    ],
  );
  const endpoint = endpointResult.rows[0];

  for (const event of events) {
    await client.query(
      `insert into webhook_subscriptions (webhook_endpoint_id, event_type)
       values ($1, $2)
       on conflict do nothing`,
      [endpoint.id, event],
    );
  }

  await client.query("commit");

  console.log("Webhook endpoint created");
  console.log(`Endpoint ID: ${endpoint.id}`);
  console.log(`Name: ${endpoint.name}`);
  console.log(`Host: ${endpoint.url_host}`);
  console.log(`Events: ${events.join(",")}`);
  console.log(`Signing secret: ${signingSecret}`);
  console.log("Store this secret securely. It will not be shown again.");
} catch {
  await client.query("rollback");
  console.error("Failed to create webhook endpoint.");
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value === "--name") {
      parsed.name = values[index + 1];
      index += 1;
      continue;
    }

    if (value === "--url") {
      parsed.url = values[index + 1];
      index += 1;
      continue;
    }

    if (value === "--events") {
      parsed.events = values[index + 1];
      index += 1;
    }
  }

  return parsed;
}

function parseEvents(value) {
  const events = value
    .split(",")
    .map((event) => event.trim())
    .filter(Boolean);
  const invalid = events.find(
    (event) =>
      !builtInEvents.has(event) &&
      (!customEventPattern.test(event) || reservedEvents.has(event)),
  );

  if (invalid) {
    console.error(`Unsupported webhook event: ${invalid}`);
    process.exit(1);
  }

  return [...new Set(events)];
}

function validateDestination(rawUrl) {
  const url = new URL(rawUrl);

  if (url.protocol !== "https:") {
    throw new Error("Webhook URL must use HTTPS.");
  }

  if (url.username || url.password) {
    throw new Error("Webhook URL must not include credentials.");
  }

  const hostname = url.hostname.toLowerCase();

  if (localHostnames.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("Webhook URL must not target a local hostname.");
  }

  if (isUnsafeIpLiteral(hostname)) {
    throw new Error("Webhook URL must not target a private or loopback IP.");
  }

  return url;
}

function encryptValue(value, encryptionKey) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(encryptionKey), iv);
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

function deriveKey(encryptionKey) {
  return createHash("sha256")
    .update("magictrust:pii:encrypt:")
    .update(encryptionKey)
    .digest();
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
