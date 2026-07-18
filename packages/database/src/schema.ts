import { relations } from "drizzle-orm";
import {
  boolean,
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const requestTypeEnum = pgEnum("request_type", [
  "DATA_ACCESS",
  "DATA_DELETION",
  "DO_NOT_CONTACT",
  "UNSUBSCRIBE",
  "GENERAL_INQUIRY",
]);

export const requestStatusEnum = pgEnum("request_status", [
  "SUBMITTED",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "PROCESSING",
  "WAITING_FOR_REQUESTER",
  "SUCCESS",
  "REJECTED",
  "CANCELLED",
]);

export const actorTypeEnum = pgEnum("actor_type", [
  "CONSUMER",
  "INTERNAL_USER",
  "ADMIN_USER",
  "API_CLIENT",
  "SYSTEM",
]);

export const requestEventTypeEnum = pgEnum("request_event_type", [
  "CUSTOM_EVENT",
  "REQUEST_CREATED",
  "STATUS_CHANGED",
  "PUBLIC_COMMENT_ADDED",
  "INTERNAL_COMMENT_ADDED",
  "PUBLIC_ATTACHMENT_ADDED",
  "INTERNAL_ATTACHMENT_ADDED",
  "ATTACHMENT_DOWNLOADED",
  "ADMIN_ATTACHMENT_DOWNLOADED",
  "EMAIL_SENT",
  "EMAIL_FAILED",
  "CONSUMER_ACCESS_LINK_SENT",
  "CONSUMER_ACCESS_TOKEN_USED",
  "CONSUMER_ACCESS_SESSION_CREATED",
  "CONSUMER_ACCESS_SESSION_USED",
  "CONSUMER_ATTACHMENT_DOWNLOADED",
  "IDENTITY_VERIFICATION_SENT",
  "IDENTITY_VERIFIED",
  "CONSUMER_NOTIFICATION_SENT",
  "CONSUMER_NOTIFICATION_FAILED",
  "REQUEST_DATA_UPDATED",
  "REQUEST_ASSIGNED",
  "REQUEST_UNASSIGNED",
  "REQUEST_DUE_DATE_SET",
  "REQUEST_DUE_DATE_UPDATED",
  "REQUEST_DUE_DATE_CLEARED",
]);

export const requestEventCategoryEnum = pgEnum("request_event_category", [
  "BUILT_IN",
  "CUSTOM",
]);

export const commentVisibilityEnum = pgEnum("comment_visibility", [
  "PUBLIC",
  "INTERNAL",
]);

export const communicationChannelEnum = pgEnum("communication_channel", [
  "EMAIL",
]);

export const communicationDirectionEnum = pgEnum("communication_direction", [
  "OUTBOUND",
]);

export const communicationStatusEnum = pgEnum("communication_status", [
  "PENDING",
  "SENT",
  "FAILED",
]);

export const adminRoleEnum = pgEnum("admin_role", [
  "ADMIN",
  "OPERATOR",
  "VIEWER",
]);

export const webhookDeliveryStatusEnum = pgEnum("webhook_delivery_status", [
  "PENDING",
  "RETRYING",
  "DELIVERED",
  "DEAD",
]);

export const requesters = pgTable(
  "requesters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: varchar("external_id", { length: 128 }),
    emailEncrypted: text("email_encrypted"),
    emailHash: text("email_hash"),
    phoneEncrypted: text("phone_encrypted"),
    phoneHash: text("phone_hash"),
    nameEncrypted: text("name_encrypted"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    externalIdIdx: index("requesters_external_id_idx").on(table.externalId),
    emailHashIdx: index("requesters_email_hash_idx").on(table.emailHash),
    phoneHashIdx: index("requesters_phone_hash_idx").on(table.phoneHash),
  }),
);

export const privacyRequests = pgTable(
  "privacy_requests",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    publicId: varchar("public_id", { length: 32 }).notNull(),
    requesterId: uuid("requester_id")
      .notNull()
      .references(() => requesters.id, { onDelete: "restrict" }),
    type: requestTypeEnum("type").notNull(),
    status: requestStatusEnum("status").default("SUBMITTED").notNull(),
    submittedData: jsonb("submitted_data").notNull(),
    submittedDataEncrypted: text("submitted_data_encrypted"),
    submittedDataHash: text("submitted_data_hash"),
    encryptionVersion: integer("encryption_version"),
    mutableData: jsonb("mutable_data").default({}).notNull(),
    assignedToAdminUserId: uuid("assigned_to_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "restrict" },
    ),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    assignedByAdminUserId: uuid("assigned_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "restrict" },
    ),
    dueAt: timestamp("due_at", { withTimezone: true }),
    dueAtSetAt: timestamp("due_at_set_at", { withTimezone: true }),
    dueAtSetByAdminUserId: uuid("due_at_set_by_admin_user_id").references(
      () => adminUsers.id,
      { onDelete: "restrict" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => ({
    publicIdIdx: uniqueIndex("privacy_requests_public_id_idx").on(
      table.publicId,
    ),
    requesterIdIdx: index("privacy_requests_requester_id_idx").on(
      table.requesterId,
    ),
    statusIdx: index("privacy_requests_status_idx").on(table.status),
    createdAtIdIdx: index("privacy_requests_created_at_id_idx").on(
      table.createdAt,
      table.id,
    ),
    statusCreatedAtIdx: index("privacy_requests_status_created_at_idx").on(
      table.status,
      table.createdAt,
    ),
    typeCreatedAtIdx: index("privacy_requests_type_created_at_idx").on(
      table.type,
      table.createdAt,
    ),
    assignedToCreatedAtIdIdx: index(
      "privacy_requests_assigned_to_created_at_id_idx",
    ).on(table.assignedToAdminUserId, table.createdAt, table.id),
    dueAtIdx: index("privacy_requests_due_at_idx").on(table.dueAt),
  }),
);

export const apiIdempotencyRecords = pgTable(
  "api_idempotency_records",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    apiClientId: varchar("api_client_id", { length: 128 }).notNull(),
    method: varchar("method", { length: 16 }).notNull(),
    route: text("route").notNull(),
    requestHash: text("request_hash").notNull(),
    responseStatus: integer("response_status").notNull(),
    responseBody: jsonb("response_body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    keyIdx: uniqueIndex("api_idempotency_records_client_key_idx").on(
      table.apiClientId,
      table.idempotencyKey,
    ),
    expiresAtIdx: index("api_idempotency_records_expires_at_idx").on(
      table.expiresAt,
    ),
  }),
);

export const apiClients = pgTable(
  "api_clients",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    activeIdx: index("api_clients_active_idx").on(table.active),
  }),
);

export const apiClientKeys = pgTable(
  "api_client_keys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    apiClientId: uuid("api_client_id")
      .notNull()
      .references(() => apiClients.id, { onDelete: "restrict" }),
    keyPrefix: varchar("key_prefix", { length: 32 }).notNull(),
    keyHash: text("key_hash").notNull(),
    active: boolean("active").default(true).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => ({
    keyPrefixIdx: index("api_client_keys_key_prefix_idx").on(table.keyPrefix),
    apiClientIdIdx: index("api_client_keys_api_client_id_idx").on(
      table.apiClientId,
    ),
  }),
);

export const apiClientScopes = pgTable(
  "api_client_scopes",
  {
    apiClientId: uuid("api_client_id")
      .notNull()
      .references(() => apiClients.id, { onDelete: "restrict" }),
    scope: varchar("scope", { length: 64 }).notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.apiClientId, table.scope] }),
  }),
);

export const adminUsers = pgTable(
  "admin_users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    emailEncrypted: text("email_encrypted").notNull(),
    emailHash: text("email_hash").notNull(),
    role: adminRoleEnum("role").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  },
  (table) => ({
    emailHashIdx: uniqueIndex("admin_users_email_hash_idx").on(table.emailHash),
    activeIdx: index("admin_users_active_idx").on(table.active),
  }),
);

export const adminLoginTokens = pgTable(
  "admin_login_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    tokenHashIdx: uniqueIndex("admin_login_tokens_token_hash_idx").on(
      table.tokenHash,
    ),
    adminUserIdIdx: index("admin_login_tokens_admin_user_id_idx").on(
      table.adminUserId,
    ),
  }),
);

export const adminSessions = pgTable(
  "admin_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    adminUserId: uuid("admin_user_id")
      .notNull()
      .references(() => adminUsers.id, { onDelete: "restrict" }),
    sessionTokenHash: text("session_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => ({
    sessionTokenHashIdx: uniqueIndex("admin_sessions_token_hash_idx").on(
      table.sessionTokenHash,
    ),
    adminUserIdIdx: index("admin_sessions_admin_user_id_idx").on(
      table.adminUserId,
    ),
  }),
);

export const requestComments = pgTable(
  "request_comments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "restrict" }),
    visibility: commentVisibilityEnum("visibility").notNull(),
    body: text("body").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: varchar("actor_id", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    requestIdIdx: index("request_comments_request_id_idx").on(table.requestId),
    visibilityIdx: index("request_comments_visibility_idx").on(
      table.visibility,
    ),
  }),
);

export const requestAttachments = pgTable(
  "request_attachments",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "restrict" }),
    visibility: commentVisibilityEnum("visibility").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: varchar("mime_type", { length: 255 }).notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageProvider: varchar("storage_provider", { length: 64 }).notNull(),
    storageKey: text("storage_key").notNull(),
    checksum: text("checksum").notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: varchar("actor_id", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    requestIdIdx: index("request_attachments_request_id_idx").on(
      table.requestId,
    ),
    visibilityIdx: index("request_attachments_visibility_idx").on(
      table.visibility,
    ),
  }),
);

export const requestCommunications = pgTable(
  "request_communications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "restrict" }),
    channel: communicationChannelEnum("channel").notNull(),
    direction: communicationDirectionEnum("direction").notNull(),
    recipient: text("recipient"),
    recipientEncrypted: text("recipient_encrypted"),
    recipientHash: text("recipient_hash"),
    encryptionVersion: integer("encryption_version"),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    provider: varchar("provider", { length: 64 }).notNull(),
    providerMessageId: text("provider_message_id"),
    status: communicationStatusEnum("status").default("PENDING").notNull(),
    errorMessage: text("error_message"),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: varchar("actor_id", { length: 128 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
  },
  (table) => ({
    requestIdIdx: index("request_communications_request_id_idx").on(
      table.requestId,
    ),
    statusIdx: index("request_communications_status_idx").on(table.status),
  }),
);

export const requestAccessTokens = pgTable(
  "request_access_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    requestIdIdx: index("request_access_tokens_request_id_idx").on(
      table.requestId,
    ),
    tokenHashIdx: uniqueIndex("request_access_tokens_token_hash_idx").on(
      table.tokenHash,
    ),
  }),
);

export const requestAccessSessions = pgTable(
  "request_access_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "restrict" }),
    sessionHash: text("session_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (table) => ({
    requestIdIdx: index("request_access_sessions_request_id_idx").on(
      table.requestId,
    ),
    sessionHashIdx: uniqueIndex("request_access_sessions_session_hash_idx").on(
      table.sessionHash,
    ),
  }),
);

export const requestIdentityVerificationTokens = pgTable(
  "request_identity_verification_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    requestIdIdx: index(
      "request_identity_verification_tokens_request_id_idx",
    ).on(table.requestId),
    tokenHashIdx: uniqueIndex(
      "request_identity_verification_tokens_token_hash_idx",
    ).on(table.tokenHash),
  }),
);

export const requestEvents = pgTable(
  "request_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    privacyRequestId: uuid("privacy_request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "restrict" }),
    type: requestEventTypeEnum("type").notNull(),
    category: requestEventCategoryEnum("category")
      .default("BUILT_IN")
      .notNull(),
    customType: varchar("custom_type", { length: 80 }),
    visibility: commentVisibilityEnum("visibility")
      .default("INTERNAL")
      .notNull(),
    actorType: actorTypeEnum("actor_type").notNull(),
    actorId: varchar("actor_id", { length: 128 }),
    data: jsonb("data").default({}).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    privacyRequestIdIdx: index("request_events_privacy_request_id_idx").on(
      table.privacyRequestId,
    ),
  }),
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: text("name").notNull(),
    urlEncrypted: text("url_encrypted").notNull(),
    urlHost: varchar("url_host", { length: 255 }).notNull(),
    signingSecretEncrypted: text("signing_secret_encrypted").notNull(),
    active: boolean("active").default(true).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    activeIdx: index("webhook_endpoints_active_idx").on(table.active),
    urlHostIdx: index("webhook_endpoints_url_host_idx").on(table.urlHost),
  }),
);

export const webhookSubscriptions = pgTable(
  "webhook_subscriptions",
  {
    webhookEndpointId: uuid("webhook_endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.webhookEndpointId, table.eventType] }),
    eventTypeIdx: index("webhook_subscriptions_event_type_idx").on(
      table.eventType,
    ),
  }),
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    webhookEndpointId: uuid("webhook_endpoint_id")
      .notNull()
      .references(() => webhookEndpoints.id, { onDelete: "restrict" }),
    requestEventId: uuid("request_event_id")
      .notNull()
      .references(() => requestEvents.id, { onDelete: "restrict" }),
    eventType: varchar("event_type", { length: 80 }).notNull(),
    payload: jsonb("payload").notNull(),
    status: webhookDeliveryStatusEnum("status").default("PENDING").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    responseStatus: integer("response_status"),
    lastErrorCode: varchar("last_error_code", { length: 64 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    endpointEventIdx: uniqueIndex("webhook_deliveries_endpoint_event_idx").on(
      table.webhookEndpointId,
      table.requestEventId,
    ),
    dueIdx: index("webhook_deliveries_due_idx").on(
      table.status,
      table.nextAttemptAt,
    ),
    endpointIdx: index("webhook_deliveries_endpoint_idx").on(
      table.webhookEndpointId,
    ),
  }),
);

export const requestersRelations = relations(requesters, ({ many }) => ({
  privacyRequests: many(privacyRequests),
}));

export const apiClientsRelations = relations(apiClients, ({ many }) => ({
  keys: many(apiClientKeys),
  scopes: many(apiClientScopes),
}));

export const apiClientKeysRelations = relations(apiClientKeys, ({ one }) => ({
  apiClient: one(apiClients, {
    fields: [apiClientKeys.apiClientId],
    references: [apiClients.id],
  }),
}));

export const apiClientScopesRelations = relations(
  apiClientScopes,
  ({ one }) => ({
    apiClient: one(apiClients, {
      fields: [apiClientScopes.apiClientId],
      references: [apiClients.id],
    }),
  }),
);

export const adminUsersRelations = relations(adminUsers, ({ many }) => ({
  loginTokens: many(adminLoginTokens),
  sessions: many(adminSessions),
  assignedRequests: many(privacyRequests, {
    relationName: "requestAssignee",
  }),
  requestAssignments: many(privacyRequests, {
    relationName: "requestAssignedBy",
  }),
  requestDueDatesSet: many(privacyRequests, {
    relationName: "requestDueDateSetBy",
  }),
}));

export const adminLoginTokensRelations = relations(
  adminLoginTokens,
  ({ one }) => ({
    adminUser: one(adminUsers, {
      fields: [adminLoginTokens.adminUserId],
      references: [adminUsers.id],
    }),
  }),
);

export const adminSessionsRelations = relations(adminSessions, ({ one }) => ({
  adminUser: one(adminUsers, {
    fields: [adminSessions.adminUserId],
    references: [adminUsers.id],
  }),
}));

export const privacyRequestsRelations = relations(
  privacyRequests,
  ({ one, many }) => ({
    requester: one(requesters, {
      fields: [privacyRequests.requesterId],
      references: [requesters.id],
    }),
    assignedToAdminUser: one(adminUsers, {
      fields: [privacyRequests.assignedToAdminUserId],
      references: [adminUsers.id],
      relationName: "requestAssignee",
    }),
    assignedByAdminUser: one(adminUsers, {
      fields: [privacyRequests.assignedByAdminUserId],
      references: [adminUsers.id],
      relationName: "requestAssignedBy",
    }),
    dueAtSetByAdminUser: one(adminUsers, {
      fields: [privacyRequests.dueAtSetByAdminUserId],
      references: [adminUsers.id],
      relationName: "requestDueDateSetBy",
    }),
    events: many(requestEvents),
    comments: many(requestComments),
    attachments: many(requestAttachments),
    communications: many(requestCommunications),
    accessTokens: many(requestAccessTokens),
    accessSessions: many(requestAccessSessions),
    identityVerificationTokens: many(requestIdentityVerificationTokens),
  }),
);

export const requestCommentsRelations = relations(
  requestComments,
  ({ one }) => ({
    privacyRequest: one(privacyRequests, {
      fields: [requestComments.requestId],
      references: [privacyRequests.id],
    }),
  }),
);

export const requestAttachmentsRelations = relations(
  requestAttachments,
  ({ one }) => ({
    privacyRequest: one(privacyRequests, {
      fields: [requestAttachments.requestId],
      references: [privacyRequests.id],
    }),
  }),
);

export const requestCommunicationsRelations = relations(
  requestCommunications,
  ({ one }) => ({
    privacyRequest: one(privacyRequests, {
      fields: [requestCommunications.requestId],
      references: [privacyRequests.id],
    }),
  }),
);

export const requestAccessTokensRelations = relations(
  requestAccessTokens,
  ({ one }) => ({
    privacyRequest: one(privacyRequests, {
      fields: [requestAccessTokens.requestId],
      references: [privacyRequests.id],
    }),
  }),
);

export const requestAccessSessionsRelations = relations(
  requestAccessSessions,
  ({ one }) => ({
    privacyRequest: one(privacyRequests, {
      fields: [requestAccessSessions.requestId],
      references: [privacyRequests.id],
    }),
  }),
);

export const requestIdentityVerificationTokensRelations = relations(
  requestIdentityVerificationTokens,
  ({ one }) => ({
    privacyRequest: one(privacyRequests, {
      fields: [requestIdentityVerificationTokens.requestId],
      references: [privacyRequests.id],
    }),
  }),
);

export const requestEventsRelations = relations(requestEvents, ({ one }) => ({
  privacyRequest: one(privacyRequests, {
    fields: [requestEvents.privacyRequestId],
    references: [privacyRequests.id],
  }),
}));

export const webhookEndpointsRelations = relations(
  webhookEndpoints,
  ({ many }) => ({
    subscriptions: many(webhookSubscriptions),
    deliveries: many(webhookDeliveries),
  }),
);

export const webhookSubscriptionsRelations = relations(
  webhookSubscriptions,
  ({ one }) => ({
    endpoint: one(webhookEndpoints, {
      fields: [webhookSubscriptions.webhookEndpointId],
      references: [webhookEndpoints.id],
    }),
  }),
);

export const webhookDeliveriesRelations = relations(
  webhookDeliveries,
  ({ one }) => ({
    endpoint: one(webhookEndpoints, {
      fields: [webhookDeliveries.webhookEndpointId],
      references: [webhookEndpoints.id],
    }),
    requestEvent: one(requestEvents, {
      fields: [webhookDeliveries.requestEventId],
      references: [requestEvents.id],
    }),
  }),
);
