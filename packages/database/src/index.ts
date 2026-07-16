import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import { getRequiredDatabaseUrl } from "@magictrust/config";

export * from "./request-creation-store";
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
  const client = neon(databaseUrl);
  return drizzle(client);
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
