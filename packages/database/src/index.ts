import { Pool } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import { sql } from "drizzle-orm";
import { getRequiredDatabaseUrl } from "@magictrust/config";

export * from "./request-creation-store";
export * from "./request-repository";
export * from "./api-idempotency-store";
export * from "./api-client-store";
export * from "./admin-auth-store";
export * from "./admin-user-management-store";
export * from "./pii-backfill";
export * from "./webhooks";
export * from "./schema";

export type DatabaseHealth =
  | {
      ok: true;
      status: "connected";
    }
  | {
      ok: false;
      status: "not_configured" | "unavailable";
      message: string;
    };

export function createDatabase(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  return drizzle(pool);
}

export async function checkDatabaseHealth(): Promise<DatabaseHealth> {
  const databaseUrl = getRequiredDatabaseUrl();

  if (!databaseUrl) {
    return {
      ok: false,
      status: "not_configured",
      message: "DATABASE_URL is not configured.",
    };
  }

  try {
    const db = createDatabase(databaseUrl);
    await db.execute(sql`select 1`);

    return {
      ok: true,
      status: "connected",
    };
  } catch {
    return {
      ok: false,
      status: "unavailable",
      message: "Database connectivity check failed.",
    };
  }
}
