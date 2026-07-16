import { checkDatabaseHealth } from "@magictrust/database";

export async function GET() {
  const database = await checkDatabaseHealth();
  const isHealthy = database.ok;

  return Response.json(
    {
      app: "MagicTrust",
      status: isHealthy ? "ok" : "degraded",
      database,
      checkedAt: new Date().toISOString(),
    },
    {
      status: isHealthy ? 200 : 503,
    },
  );
}
