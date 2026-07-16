import { relations } from "drizzle-orm";
import {
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
]);

export const commentVisibilityEnum = pgEnum("comment_visibility", [
  "PUBLIC",
  "INTERNAL",
]);

export const requesters = pgTable(
  "requesters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: varchar("external_id", { length: 128 }),
    // TODO: populate encrypted PII fields when field encryption is introduced.
    emailEncrypted: text("email_encrypted"),
    phoneEncrypted: text("phone_encrypted"),
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

export const requestEventsRelations = relations(requestEvents, ({ one }) => ({
  privacyRequest: one(privacyRequests, {
    fields: [requestEvents.privacyRequestId],
    references: [privacyRequests.id],
  }),
}));
