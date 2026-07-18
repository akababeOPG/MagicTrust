import { getAppBaseUrl, getRequiredDatabaseUrl } from "@magictrust/config";
import {
  createDatabase,
  createRequestCreationStore,
  createRequestRepository,
} from "@magictrust/database";
import { createResendEmailProvider } from "@magictrust/email";
import { createVercelBlobPrivateStorageProvider } from "@magictrust/storage";

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
        findAdminSensitiveData() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        list() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        listActiveAssignableAdminUsers() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        findAdminUsersByIds() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        assignRequest() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        unassignRequest() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        updateStatus() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        updateMutableData() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        addCustomEvent() {
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
        recordAdminAttachmentDownloaded() {
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
        findConsumerAccessLinkTarget() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        findConsumerNotificationTarget() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        createConsumerAccessToken() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        createConsumerNotificationAccessToken() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        recordConsumerAccessLinkSent() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        markConsumerNotificationSent() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        markConsumerNotificationFailed() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        consumeConsumerAccessToken() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        validateConsumerAccessSession() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        recordConsumerAttachmentDownloaded() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        createIdentityVerificationToken() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        recordIdentityVerificationSent() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
        verifyIdentityToken() {
          throw new Error("DATABASE_URL is required for public request APIs.");
        },
      },
      emailProvider: createResendEmailProvider(),
      storageProvider: createVercelBlobPrivateStorageProvider(),
      appBaseUrl: getAppBaseUrl(),
      now: () => new Date(),
    };
  }

  const db = createDatabase(databaseUrl);

  return {
    requestCreationStore: createRequestCreationStore(db),
    requestRepository: createRequestRepository(db),
    emailProvider: createResendEmailProvider(),
    storageProvider: createVercelBlobPrivateStorageProvider(),
    appBaseUrl: getAppBaseUrl(),
    now: () => new Date(),
  };
}
