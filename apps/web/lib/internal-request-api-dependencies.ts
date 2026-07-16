import { getInternalApiKey, getRequiredDatabaseUrl } from "@magictrust/config";
import {
  createDatabase,
  createRequestCreationStore,
  createRequestRepository,
} from "@magictrust/database";

import type { InternalRequestApiDependencies } from "./internal-request-api";

export function getInternalRequestApiDependencies(): InternalRequestApiDependencies {
  const databaseUrl = getRequiredDatabaseUrl();

  if (!databaseUrl) {
    return {
      apiKey: getInternalApiKey(),
      requestCreationStore: {
        transaction() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
      },
      requestRepository: {
        findByIdOrPublicId() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        list() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
      },
    };
  }

  const db = createDatabase(databaseUrl);

  return {
    apiKey: getInternalApiKey(),
    requestCreationStore: createRequestCreationStore(db),
    requestRepository: createRequestRepository(db),
  };
}
