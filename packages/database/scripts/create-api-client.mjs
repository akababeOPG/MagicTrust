import { randomBytes, createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadEnvFile } from "node:process";

import { Pool } from "@neondatabase/serverless";

const allowedScopes = new Set([
  "requests:read",
  "requests:processing-data:read",
  "requests:create",
  "requests:update",
  "comments:write",
  "attachments:write",
  "attachments:read",
  "communications:write",
  "notifications:write",
  "events:write",
]);

const rootDirectory = findWorkspaceRoot(process.cwd());
const localEnvPath = join(rootDirectory, ".env.local");

if (existsSync(localEnvPath)) {
  loadEnvFile(localEnvPath);
}

const args = parseArgs(process.argv.slice(2));
const name = args.name;
const scopes = parseScopes(args.scopes);

if (!name || scopes.length === 0) {
  console.error(
    'Usage: pnpm api-client:create --name "Privacy Processor" --scopes "requests:read,requests:update"',
  );
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error("DATABASE_URL is required in the root .env.local file.");
  process.exit(1);
}

const rawKey = generateApiKey();
const keyPrefix = rawKey.slice(0, 16);
const keyHash = createHash("sha256").update(rawKey).digest("hex");
const pool = new Pool({ connectionString: databaseUrl });
const client = await pool.connect();

try {
  await client.query("begin");

  const createdClient = await client.query(
    `insert into api_clients (name)
     values ($1)
     returning id, name`,
    [name],
  );
  const apiClient = createdClient.rows[0];

  await client.query(
    `insert into api_client_keys (api_client_id, key_prefix, key_hash)
     values ($1, $2, $3)`,
    [apiClient.id, keyPrefix, keyHash],
  );

  for (const scope of scopes) {
    await client.query(
      `insert into api_client_scopes (api_client_id, scope)
       values ($1, $2)`,
      [apiClient.id, scope],
    );
  }

  await client.query("commit");

  console.log("API client created");
  console.log(`Client ID: ${apiClient.id}`);
  console.log(`Name: ${apiClient.name}`);
  console.log(`Scopes: ${scopes.join(",")}`);
  console.log(`API key: ${rawKey}`);
  console.log("Store this key securely. It will not be shown again.");
} catch {
  await client.query("rollback");
  console.error("Failed to create API client.");
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

    if (value === "--scopes") {
      parsed.scopes = values[index + 1];
      index += 1;
    }
  }

  return parsed;
}

function parseScopes(value) {
  if (!value) {
    return [];
  }

  const scopes = value
    .split(",")
    .map((scope) => scope.trim())
    .filter(Boolean);

  const unknownScope = scopes.find((scope) => !allowedScopes.has(scope));

  if (unknownScope) {
    console.error(`Unknown scope: ${unknownScope}`);
    process.exit(1);
  }

  return scopes;
}

function generateApiKey() {
  return `mt_live_${randomBytes(32).toString("base64url")}`;
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
