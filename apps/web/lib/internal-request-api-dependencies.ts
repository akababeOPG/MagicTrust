import {
  getAppEnv,
  getAppBaseUrl,
  getInternalApiKey,
  getRequiredDatabaseUrl,
} from "@magictrust/config";
import {
  createDatabase,
  createApiClientStore,
  createApiIdempotencyStore,
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
      apiClientStore: {
        authenticateApiKey() {
          return Promise.resolve(null);
        },
      },
      appEnv: getAppEnv(),
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
        findAdminSensitiveData() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        list() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        listActiveAssignableAdminUsers() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        findAdminUsersByIds() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        assignRequest() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        unassignRequest() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        setRequestDueDate() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        clearRequestDueDate() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        updateStatus() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        updateMutableData() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        addCustomEvent() {
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
        recordAdminAttachmentDownloaded() {
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
        findConsumerAccessLinkTarget() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        findConsumerNotificationTarget() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        createConsumerAccessToken() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        createConsumerNotificationAccessToken() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        recordConsumerAccessLinkSent() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        markConsumerNotificationSent() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        markConsumerNotificationFailed() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        consumeConsumerAccessToken() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        validateConsumerAccessSession() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        recordConsumerAttachmentDownloaded() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        createIdentityVerificationToken() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        recordIdentityVerificationSent() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        verifyIdentityToken() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
      },
      idempotencyStore: {
        findActive() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
        create() {
          throw new Error(
            "DATABASE_URL is required for internal request APIs.",
          );
        },
      },
      storageProvider: createVercelBlobPrivateStorageProvider(),
      emailProvider: createResendEmailProvider(),
      appBaseUrl: getAppBaseUrl(),
    };
  }

  const db = createDatabase(databaseUrl);

  return {
    apiKey: getInternalApiKey(),
    apiClientStore: createApiClientStore(db),
    appEnv: getAppEnv(),
    requestCreationStore: createRequestCreationStore(db),
    requestRepository: createRequestRepository(db),
    idempotencyStore: createApiIdempotencyStore(db),
    storageProvider: createVercelBlobPrivateStorageProvider(),
    emailProvider: createResendEmailProvider(),
    appBaseUrl: getAppBaseUrl(),
  };
}
