import { getRequiredDatabaseUrl } from "@magictrust/config";
import {
  createDatabase,
  createRequestCreationStore,
} from "@magictrust/database";

import type { PublicRequestApiDependencies } from "./public-request-api";

export function getPublicRequestApiDependencies(): PublicRequestApiDependencies {
  const databaseUrl = getRequiredDatabaseUrl();

  if (!databaseUrl) {
    return {
      requestCreationStore: {
        transaction() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
      },
    };
  }

  return {
    requestCreationStore: createRequestCreationStore(
      createDatabase(databaseUrl),
    ),
  };
}
