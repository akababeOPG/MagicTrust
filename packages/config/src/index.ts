import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { z } from "zod";

const localEnvPath = new URL("../../../.env.local", import.meta.url);

if (existsSync(localEnvPath)) {
  loadEnvFile(localEnvPath);
}

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  DATABASE_URL_UNPOOLED: z.string().url().optional(),
  INTERNAL_API_KEY: z.string().min(1).optional(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  NEXT_PUBLIC_APP_NAME: z.string().default("MagicTrust"),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function getServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  return serverEnvSchema.parse(env);
}

export function getRequiredDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return getServerEnv(env).DATABASE_URL ?? null;
}

export function getRequiredMigrationDatabaseUrl(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return getServerEnv(env).DATABASE_URL_UNPOOLED ?? null;
}

export function getInternalApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return getServerEnv(env).INTERNAL_API_KEY ?? null;
}

export function getBlobReadWriteToken(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return getServerEnv(env).BLOB_READ_WRITE_TOKEN ?? null;
}
