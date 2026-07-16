import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { defineConfig } from "drizzle-kit";
import { getRequiredDatabaseUrl } from "@magictrust/config";

const localEnvPath = new URL("../../apps/web/.env.local", import.meta.url);

if (existsSync(localEnvPath)) {
  loadEnvFile(localEnvPath);
}

const databaseUrl = getRequiredDatabaseUrl();

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl ?? "",
  },
  verbose: true,
  strict: true,
});
