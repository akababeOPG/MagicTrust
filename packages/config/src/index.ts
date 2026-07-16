import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { dirname, join } from "node:path";

import { z } from "zod";

const localEnvPath = findLocalEnvFile(process.cwd());

if (localEnvPath) {
  loadEnvFile(localEnvPath);
}

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
  DATABASE_URL_UNPOOLED: z.string().url().optional(),
  INTERNAL_API_KEY: z.string().min(1).optional(),
  BLOB_READ_WRITE_TOKEN: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  EMAIL_FROM: z.string().min(1).optional(),
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

export function getResendApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return getServerEnv(env).RESEND_API_KEY ?? null;
}

export function getEmailFrom(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return getServerEnv(env).EMAIL_FROM ?? null;
}

function findLocalEnvFile(startDirectory: string): string | null {
  let currentDirectory = startDirectory;

  while (true) {
    const workspaceCandidate = join(currentDirectory, "pnpm-workspace.yaml");

    if (existsSync(workspaceCandidate)) {
      const workspaceEnvFile = join(currentDirectory, ".env.local");

      return existsSync(workspaceEnvFile) ? workspaceEnvFile : null;
    }

    const parentDirectory = dirname(currentDirectory);

    if (parentDirectory === currentDirectory) {
      const localEnvFile = join(startDirectory, ".env.local");

      return existsSync(localEnvFile) ? localEnvFile : null;
    }

    currentDirectory = parentDirectory;
  }
}
