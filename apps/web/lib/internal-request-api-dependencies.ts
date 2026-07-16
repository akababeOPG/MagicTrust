import { getInternalApiKey, getRequiredDatabaseUrl } from "@magictrust/config";
import {
  createDatabase,
  createRequestCreationStore,
  createRequestRepository,
} from "@magictrust/database";
import { createResendEmailProvider } from "@magictrust/email";
import { createVercelBlobPrivateStorageProvider } from "@magictrust/storage";

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
        updateStatus() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        addComment() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        addAttachment() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        recordAttachmentDownloaded() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        createCommunication() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        markCommunicationSent() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        markCommunicationFailed() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
      },
      storageProvider: createVercelBlobPrivateStorageProvider(),
      emailProvider: createResendEmailProvider(),
    };
  }

  const db = createDatabase(databaseUrl);

  return {
    apiKey: getInternalApiKey(),
    requestCreationStore: createRequestCreationStore(db),
    requestRepository: createRequestRepository(db),
    storageProvider: createVercelBlobPrivateStorageProvider(),
    emailProvider: createResendEmailProvider(),
  };
}
