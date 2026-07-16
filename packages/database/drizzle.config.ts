import { defineConfig } from "drizzle-kit";
import { getRequiredMigrationDatabaseUrl } from "@magictrust/config";

const migrationDatabaseUrl = getRequiredMigrationDatabaseUrl();

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: migrationDatabaseUrl ?? "",
  },
  verbose: true,
  strict: true,
});
