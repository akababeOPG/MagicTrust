import { relations } from "drizzle-orm";
import {
  integer,
  index,
  jsonb,
  pgEnum,
  pgTable,
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
  "API_CLIENT",
  "SYSTEM",
]);

export const requestEventTypeEnum = pgEnum("request_event_type", [
  "REQUEST_CREATED",
  "STATUS_CHANGED",
  "PUBLIC_COMMENT_ADDED",
  "INTERNAL_COMMENT_ADDED",
  "PUBLIC_ATTACHMENT_ADDED",
  "INTERNAL_ATTACHMENT_ADDED",
  "ATTACHMENT_DOWNLOADED",
  "EMAIL_SENT",
  "EMAIL_FAILED",
  "CONSUMER_ACCESS_LINK_SENT",
  "CONSUMER_ACCESS_TOKEN_USED",
  "CONSUMER_ACCESS_SESSION_CREATED",
  "CONSUMER_ACCESS_SESSION_USED",
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
    mutableData: jsonb("mutable_data").default({}).notNull(),
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
    recipient: text("recipient").notNull(),
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

export const requestEvents = pgTable(
  "request_events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    privacyRequestId: uuid("privacy_request_id")
      .notNull()
      .references(() => privacyRequests.id, { onDelete: "restrict" }),
    type: requestEventTypeEnum("type").notNull(),
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

export const requestersRelations = relations(requesters, ({ many }) => ({
  privacyRequests: many(privacyRequests),
}));

export const privacyRequestsRelations = relations(
  privacyRequests,
  ({ one, many }) => ({
    requester: one(requesters, {
      fields: [privacyRequests.requesterId],
      references: [requesters.id],
    }),
    events: many(requestEvents),
    comments: many(requestComments),
    attachments: many(requestAttachments),
    communications: many(requestCommunications),
    accessTokens: many(requestAccessTokens),
    accessSessions: many(requestAccessSessions),
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

export const requestEventsRelations = relations(requestEvents, ({ one }) => ({
  privacyRequest: one(privacyRequests, {
    fields: [requestEvents.privacyRequestId],
    references: [privacyRequests.id],
  }),
}));
