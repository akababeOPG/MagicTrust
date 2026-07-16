import { z } from "zod";

const serverEnvSchema = z.object({
  DATABASE_URL: z.string().url().optional(),
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
