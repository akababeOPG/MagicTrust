import { getRequiredDatabaseUrl } from "@magictrust/config";
import {
  createDatabase,
  createRequestCreationStore,
  createRequestRepository,
} from "@magictrust/database";
import { createResendEmailProvider } from "@magictrust/email";

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
      requestRepository: {
        findByIdOrPublicId() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        list() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        updateStatus() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        addComment() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        addAttachment() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        recordAttachmentDownloaded() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        createCommunication() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        markCommunicationSent() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        markCommunicationFailed() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
      },
      emailProvider: createResendEmailProvider(),
    };
  }

  const db = createDatabase(databaseUrl);

  return {
    requestCreationStore: createRequestCreationStore(db),
    requestRepository: createRequestRepository(db),
    emailProvider: createResendEmailProvider(),
  };
}
