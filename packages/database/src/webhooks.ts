import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";

import type {
  ActorType,
  CommentVisibility,
  JsonObject,
  JsonValue,
  RequestEventType,
  RequestStatus,
  RequestType,
} from "@magictrust/domain";
import { decryptPii, encryptPii, stableStringify } from "@magictrust/privacy";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { createDatabase } from "./index";
import {
  privacyRequests,
  requestEvents,
  webhookDeliveries,
  webhookEndpoints,
  webhookSubscriptions,
} from "./schema";

type Database = ReturnType<typeof createDatabase>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryExecutor = Database | Transaction;

export const webhookDeliveryStatuses = [
  "PENDING",
  "RETRYING",
  "DELIVERED",
  "DEAD",
] as const;

export type WebhookDeliveryStatus = (typeof webhookDeliveryStatuses)[number];

export type WebhookEventInput = {
  privacyRequestId: string;
  type: RequestEventType;
  category?: "BUILT_IN" | "CUSTOM";
  customType?: string | null;
  visibility?: CommentVisibility;
  actorType: ActorType;
  actorId: string | null;
  data: JsonObject;
};

export type WebhookPayload = {
  version: "1";
  deliveryId: string;
  event: {
    id: string;
    type: string;
    occurredAt: string;
    visibility: CommentVisibility;
  };
  request: {
    id: string;
    publicId: string;
    type: RequestType;
    status: RequestStatus;
    createdAt: string;
    updatedAt: string;
  };
  actor: {
    type: ActorType;
    id: string | null;
  };
  data: JsonObject;
};

export type WebhookDeliveryClaim = {
  id: string;
  webhookEndpointId: string;
  requestEventId: string;
  eventType: string;
  payload: WebhookPayload;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  lastAttemptAt: Date | null;
  deliveredAt: Date | null;
  responseStatus: number | null;
  lastErrorCode: string | null;
  endpointActive: boolean;
  urlEncrypted: string;
  urlHost: string;
  signingSecretEncrypted: string;
};

export type WebhookDeliveryResult = {
  claimed: number;
  delivered: number;
  retrying: number;
  dead: number;
};

export type WebhookFetch = (
  input: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    redirect: "manual";
    signal: AbortSignal;
  },
) => Promise<{ status: number }>;

export const builtInWebhookEventTypes = [
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
] as const;

const builtInWebhookEventTypeSet = new Set<string>(builtInWebhookEventTypes);
const reservedWebhookEventTypeSet = new Set<string>([
  ...builtInWebhookEventTypes,
  "CUSTOM_EVENT",
]);
const customEventNamePattern = /^[A-Z][A-Z0-9_]{2,79}$/;
const localHostnames = new Set([
  "localhost",
  "localhost.localdomain",
  "host.docker.internal",
  "127.0.0.1",
  "::1",
]);
const retryDelaysMs = [
  60 * 1000,
  5 * 60 * 1000,
  30 * 60 * 1000,
  2 * 60 * 60 * 1000,
  12 * 60 * 60 * 1000,
];
const maxAttempts = 5;

export function generateWebhookSigningSecret(): string {
  return `whsec_${randomBytes(32).toString("base64url")}`;
}

export function validateWebhookEventName(value: string): boolean {
  return (
    builtInWebhookEventTypeSet.has(value) ||
    (customEventNamePattern.test(value) &&
      !reservedWebhookEventTypeSet.has(value))
  );
}

export function parseWebhookEvents(value: string): string[] {
  const events = value
    .split(",")
    .map((event) => event.trim())
    .filter(Boolean);

  const unknown = events.find((event) => !validateWebhookEventName(event));

  if (unknown) {
    throw new Error(`Unsupported webhook event: ${unknown}`);
  }

  return [...new Set(events)];
}

export function validateWebhookDestination(rawUrl: string): URL {
  const url = new URL(rawUrl);

  if (url.protocol !== "https:") {
    throw new Error("Webhook URL must use HTTPS.");
  }

  if (url.username || url.password) {
    throw new Error("Webhook URL must not include credentials.");
  }

  const hostname = url.hostname.toLowerCase();

  if (localHostnames.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error("Webhook URL must not target a local hostname.");
  }

  if (isUnsafeIpLiteral(hostname)) {
    throw new Error("Webhook URL must not target a private or loopback IP.");
  }

  return url;
}

export function prepareWebhookEndpointCreate(input: {
  name: string;
  url: string;
  events: string[];
  signingSecret?: string;
}): {
  name: string;
  urlEncrypted: string;
  urlHost: string;
  signingSecret: string;
  signingSecretEncrypted: string;
  events: string[];
} {
  const parsedUrl = validateWebhookDestination(input.url);
  const events = input.events.filter(validateWebhookEventName);

  if (events.length !== input.events.length || events.length === 0) {
    throw new Error("At least one valid webhook event is required.");
  }

  const signingSecret = input.signingSecret ?? generateWebhookSigningSecret();

  return {
    name: input.name.trim(),
    urlEncrypted: encryptPii(parsedUrl.toString()),
    urlHost: parsedUrl.hostname,
    signingSecret,
    signingSecretEncrypted: encryptPii(signingSecret),
    events: [...new Set(events)],
  };
}

export async function createWebhookEndpoint(
  db: Database,
  input: {
    name: string;
    url: string;
    events: string[];
    signingSecret?: string;
  },
): Promise<{
  id: string;
  name: string;
  urlHost: string;
  signingSecret: string;
  events: string[];
}> {
  const prepared = prepareWebhookEndpointCreate(input);

  return db.transaction(async (tx) => {
    const [endpoint] = await tx
      .insert(webhookEndpoints)
      .values({
        name: prepared.name,
        urlEncrypted: prepared.urlEncrypted,
        urlHost: prepared.urlHost,
        signingSecretEncrypted: prepared.signingSecretEncrypted,
      })
      .returning({
        id: webhookEndpoints.id,
        name: webhookEndpoints.name,
        urlHost: webhookEndpoints.urlHost,
      });

    await tx.insert(webhookSubscriptions).values(
      prepared.events.map((eventType) => ({
        webhookEndpointId: endpoint.id,
        eventType,
      })),
    );

    return {
      ...endpoint,
      signingSecret: prepared.signingSecret,
      events: prepared.events,
    };
  });
}

export async function createRequestEventAndEnqueueWebhooks(
  executor: QueryExecutor,
  input: WebhookEventInput,
): Promise<{
  id: string;
  privacyRequestId: string;
  type: RequestEventType;
  category: "BUILT_IN" | "CUSTOM";
  customType: string | null;
  visibility: CommentVisibility;
  actorType: ActorType;
  actorId: string | null;
  data: JsonObject;
  createdAt: Date;
}> {
  const [event] = await executor
    .insert(requestEvents)
    .values({
      privacyRequestId: input.privacyRequestId,
      type: input.type,
      category: input.category ?? "BUILT_IN",
      customType: input.customType ?? null,
      visibility: input.visibility ?? "INTERNAL",
      actorType: input.actorType,
      actorId: input.actorId,
      data: input.data,
    })
    .returning({
      id: requestEvents.id,
      privacyRequestId: requestEvents.privacyRequestId,
      type: requestEvents.type,
      category: requestEvents.category,
      customType: requestEvents.customType,
      visibility: requestEvents.visibility,
      actorType: requestEvents.actorType,
      actorId: requestEvents.actorId,
      data: requestEvents.data,
      createdAt: requestEvents.createdAt,
    });

  const normalizedEvent = {
    ...event,
    category: event.category ?? "BUILT_IN",
    customType: event.customType ?? null,
    visibility: event.visibility ?? "INTERNAL",
    data: event.data as JsonObject,
  };

  await enqueueWebhookDeliveries(executor, normalizedEvent);

  return normalizedEvent;
}

export async function enqueueWebhookDeliveries(
  executor: QueryExecutor,
  event: {
    id: string;
    privacyRequestId: string;
    type: RequestEventType;
    category: "BUILT_IN" | "CUSTOM";
    customType: string | null;
    visibility?: CommentVisibility | null;
    actorType: ActorType;
    actorId: string | null;
    data: JsonObject;
    createdAt: Date;
  },
): Promise<void> {
  const effectiveEventType = getEffectiveWebhookEventType(event);
  const endpoints = await executor
    .select({
      id: webhookEndpoints.id,
    })
    .from(webhookSubscriptions)
    .innerJoin(
      webhookEndpoints,
      eq(webhookSubscriptions.webhookEndpointId, webhookEndpoints.id),
    )
    .where(
      and(
        eq(webhookSubscriptions.eventType, effectiveEventType),
        eq(webhookEndpoints.active, true),
      ),
    );

  if (endpoints.length === 0) {
    return;
  }

  const [request] = await executor
    .select({
      id: privacyRequests.id,
      publicId: privacyRequests.publicId,
      type: privacyRequests.type,
      status: privacyRequests.status,
      createdAt: privacyRequests.createdAt,
      updatedAt: privacyRequests.updatedAt,
    })
    .from(privacyRequests)
    .where(eq(privacyRequests.id, event.privacyRequestId))
    .limit(1);

  if (!request) {
    return;
  }

  await executor
    .insert(webhookDeliveries)
    .values(
      endpoints.map((endpoint) => {
        const deliveryId = randomUUID();
        const payload = buildWebhookPayload({
          deliveryId,
          effectiveEventType,
          event,
          request,
        });

        return {
          id: deliveryId,
          webhookEndpointId: endpoint.id,
          requestEventId: event.id,
          eventType: effectiveEventType,
          payload,
        };
      }),
    )
    .onConflictDoNothing();
}

export function buildWebhookPayload(input: {
  deliveryId: string;
  effectiveEventType: string;
  event: {
    id: string;
    visibility?: CommentVisibility | null;
    actorType: ActorType;
    actorId: string | null;
    data: JsonObject;
    type: RequestEventType;
    category: "BUILT_IN" | "CUSTOM";
    customType: string | null;
    createdAt: Date;
  };
  request: {
    id: string;
    publicId: string;
    type: RequestType;
    status: RequestStatus;
    createdAt: Date;
    updatedAt: Date;
  };
}): WebhookPayload {
  return {
    version: "1",
    deliveryId: input.deliveryId,
    event: {
      id: input.event.id,
      type: input.effectiveEventType,
      occurredAt: input.event.createdAt.toISOString(),
      visibility: input.event.visibility ?? "INTERNAL",
    },
    request: {
      id: input.request.id,
      publicId: input.request.publicId,
      type: input.request.type,
      status: input.request.status,
      createdAt: input.request.createdAt.toISOString(),
      updatedAt: input.request.updatedAt.toISOString(),
    },
    actor: {
      type: input.event.actorType,
      id: input.event.actorId,
    },
    data: sanitizeWebhookEventData(input.event),
  };
}

export function serializeWebhookPayload(payload: WebhookPayload): string {
  return stableStringify(payload);
}

export function signWebhookPayload(input: {
  signingSecret: string;
  timestamp: number;
  body: string;
}): string {
  return `v1=${createHmac("sha256", input.signingSecret)
    .update(`${input.timestamp}.${input.body}`)
    .digest("hex")}`;
}

export async function deliverDueWebhooks(
  db: Database,
  input: {
    limit?: number;
    now?: Date;
    fetchImpl?: WebhookFetch;
  } = {},
): Promise<WebhookDeliveryResult> {
  const now = input.now ?? new Date();
  const limit = input.limit ?? 50;
  const claimed = await claimDueWebhookDeliveries(db, { limit, now });
  const fetchImpl = input.fetchImpl ?? (fetch as unknown as WebhookFetch);
  const result: WebhookDeliveryResult = {
    claimed: claimed.length,
    delivered: 0,
    retrying: 0,
    dead: 0,
  };

  for (const delivery of claimed) {
    const outcome = await deliverWebhook(db, delivery, {
      now,
      fetchImpl,
    });
    result[outcome] += 1;
  }

  return result;
}

export async function claimDueWebhookDeliveries(
  db: Database,
  input: { limit: number; now: Date },
): Promise<WebhookDeliveryClaim[]> {
  const result = await db.execute(sql`
    with candidates as (
      select d.id
      from webhook_deliveries d
      where d.status in ('PENDING', 'RETRYING')
        and d.next_attempt_at <= ${input.now}
      order by d.created_at asc
      limit ${input.limit}
      for update skip locked
    )
    update webhook_deliveries d
    set attempt_count = d.attempt_count + 1,
        last_attempt_at = ${input.now},
        updated_at = ${input.now}
    from candidates
    where d.id = candidates.id
    returning
      d.id,
      d.webhook_endpoint_id,
      d.request_event_id,
      d.event_type,
      d.payload,
      d.status,
      d.attempt_count,
      d.next_attempt_at,
      d.last_attempt_at,
      d.delivered_at,
      d.response_status,
      d.last_error_code,
      (select active from webhook_endpoints e where e.id = d.webhook_endpoint_id) as endpoint_active,
      (select url_encrypted from webhook_endpoints e where e.id = d.webhook_endpoint_id) as url_encrypted,
      (select url_host from webhook_endpoints e where e.id = d.webhook_endpoint_id) as url_host,
      (select signing_secret_encrypted from webhook_endpoints e where e.id = d.webhook_endpoint_id) as signing_secret_encrypted
  `);

  return result.rows.map((row) => ({
    id: String(row.id),
    webhookEndpointId: String(row.webhook_endpoint_id),
    requestEventId: String(row.request_event_id),
    eventType: String(row.event_type),
    payload: row.payload as WebhookPayload,
    status: row.status as WebhookDeliveryStatus,
    attemptCount: Number(row.attempt_count),
    nextAttemptAt: new Date(String(row.next_attempt_at)),
    lastAttemptAt: row.last_attempt_at
      ? new Date(String(row.last_attempt_at))
      : null,
    deliveredAt: row.delivered_at ? new Date(String(row.delivered_at)) : null,
    responseStatus:
      row.response_status === null ? null : Number(row.response_status),
    lastErrorCode:
      row.last_error_code === null ? null : String(row.last_error_code),
    endpointActive: row.endpoint_active === true,
    urlEncrypted: String(row.url_encrypted),
    urlHost: String(row.url_host),
    signingSecretEncrypted: String(row.signing_secret_encrypted),
  }));
}

export async function deliverWebhook(
  db: Database,
  delivery: WebhookDeliveryClaim,
  input: {
    now: Date;
    fetchImpl: WebhookFetch;
  },
): Promise<"delivered" | "retrying" | "dead"> {
  if (!delivery.endpointActive) {
    await markWebhookDeliveryDead(db, delivery.id, input.now, {
      responseStatus: null,
      lastErrorCode: "ENDPOINT_INACTIVE",
    });
    return "dead";
  }

  let url: URL;
  let signingSecret: string;

  try {
    url = validateWebhookDestination(decryptPii(delivery.urlEncrypted));
    signingSecret = decryptPii(delivery.signingSecretEncrypted);
  } catch {
    await markWebhookDeliveryDead(db, delivery.id, input.now, {
      responseStatus: null,
      lastErrorCode: "UNSAFE_ENDPOINT",
    });
    return "dead";
  }

  const body = serializeWebhookPayload(delivery.payload);
  const timestamp = Math.floor(input.now.getTime() / 1000);
  const signature = signWebhookPayload({
    signingSecret,
    timestamp,
    body,
  });

  try {
    const response = await input.fetchImpl(url.toString(), {
      method: "POST",
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
      body,
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "MagicTrust-Webhooks/1.0",
        "X-MagicTrust-Event": delivery.eventType,
        "X-MagicTrust-Delivery-Id": delivery.id,
        "X-MagicTrust-Timestamp": timestamp.toString(),
        "X-MagicTrust-Signature": signature,
      },
    });

    if (response.status >= 200 && response.status < 300) {
      await markWebhookDeliveryDelivered(db, delivery.id, input.now, {
        responseStatus: response.status,
      });
      return "delivered";
    }

    if (isRetryableWebhookStatus(response.status)) {
      return recordWebhookFailure(db, delivery, input.now, {
        responseStatus: response.status,
        lastErrorCode: `HTTP_${response.status}`,
      });
    }

    await markWebhookDeliveryDead(db, delivery.id, input.now, {
      responseStatus: response.status,
      lastErrorCode: `HTTP_${response.status}`,
    });
    return "dead";
  } catch {
    return recordWebhookFailure(db, delivery, input.now, {
      responseStatus: null,
      lastErrorCode: "NETWORK_ERROR",
    });
  }
}

export function getEffectiveWebhookEventType(event: {
  type: RequestEventType;
  category: "BUILT_IN" | "CUSTOM";
  customType: string | null;
}): string {
  if (event.category === "BUILT_IN") {
    if (event.type === "CUSTOM_EVENT") {
      throw new Error("Built-in webhook events require a built-in event type.");
    }

    return event.type;
  }

  if (
    event.type !== "CUSTOM_EVENT" ||
    !event.customType ||
    !validateWebhookEventName(event.customType) ||
    builtInWebhookEventTypeSet.has(event.customType)
  ) {
    throw new Error("Custom webhook events require a valid custom event type.");
  }

  return event.customType;
}

function sanitizeWebhookEventData(event: {
  type: RequestEventType;
  category: "BUILT_IN" | "CUSTOM";
  data: JsonObject;
}): JsonObject {
  if (event.category === "CUSTOM") {
    return event.data;
  }

  switch (event.type) {
    case "STATUS_CHANGED":
      return pickJsonObject(event.data, ["previousStatus", "newStatus"]);
    case "REQUEST_DATA_UPDATED":
      return pickJsonObject(event.data, ["changedKeys", "reason"]);
    case "REQUEST_ASSIGNED":
      return pickJsonObject(event.data, [
        "assignedToAdminUserId",
        "assignedByAdminUserId",
      ]);
    case "REQUEST_UNASSIGNED":
      return pickJsonObject(event.data, [
        "previouslyAssignedToAdminUserId",
        "assignedByAdminUserId",
      ]);
    case "REQUEST_DUE_DATE_SET":
      return pickJsonObject(event.data, ["dueAt"]);
    case "REQUEST_DUE_DATE_UPDATED":
      return pickJsonObject(event.data, ["previousDueAt", "dueAt"]);
    case "REQUEST_DUE_DATE_CLEARED":
      return pickJsonObject(event.data, ["previousDueAt"]);
    case "PUBLIC_COMMENT_ADDED":
    case "INTERNAL_COMMENT_ADDED":
      return pickJsonObject(event.data, ["commentId", "visibility"]);
    case "PUBLIC_ATTACHMENT_ADDED":
    case "INTERNAL_ATTACHMENT_ADDED":
    case "CONSUMER_ATTACHMENT_DOWNLOADED":
    case "ADMIN_ATTACHMENT_DOWNLOADED":
      return pickJsonObject(event.data, [
        "attachmentId",
        "visibility",
        "fileName",
        "mimeType",
        "sizeBytes",
      ]);
    case "EMAIL_SENT":
    case "EMAIL_FAILED":
    case "CONSUMER_NOTIFICATION_SENT":
    case "CONSUMER_NOTIFICATION_FAILED":
      return pickJsonObject(event.data, [
        "communicationId",
        "provider",
        "status",
        "notificationType",
      ]);
    case "REQUEST_CREATED":
      return {};
    default:
      return {};
  }
}

function pickJsonObject(value: JsonObject, keys: string[]): JsonObject {
  const output: JsonObject = {};

  for (const key of keys) {
    const child = value[key];

    if (isJsonValue(child)) {
      output[key] = child;
    }
  }

  return output;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).every(isJsonValue);
  }

  return false;
}

async function recordWebhookFailure(
  db: Database,
  delivery: WebhookDeliveryClaim,
  now: Date,
  input: {
    responseStatus: number | null;
    lastErrorCode: string;
  },
): Promise<"retrying" | "dead"> {
  if (delivery.attemptCount >= maxAttempts) {
    await markWebhookDeliveryDead(db, delivery.id, now, input);
    return "dead";
  }

  const delay = retryDelaysMs[delivery.attemptCount - 1] ?? retryDelaysMs[0];
  await db
    .update(webhookDeliveries)
    .set({
      status: "RETRYING",
      nextAttemptAt: new Date(now.getTime() + delay),
      responseStatus: input.responseStatus,
      lastErrorCode: input.lastErrorCode,
      updatedAt: now,
    })
    .where(eq(webhookDeliveries.id, delivery.id));

  return "retrying";
}

async function markWebhookDeliveryDelivered(
  db: Database,
  deliveryId: string,
  now: Date,
  input: {
    responseStatus: number;
  },
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({
      status: "DELIVERED",
      deliveredAt: now,
      responseStatus: input.responseStatus,
      lastErrorCode: null,
      updatedAt: now,
    })
    .where(eq(webhookDeliveries.id, deliveryId));
}

async function markWebhookDeliveryDead(
  db: Database,
  deliveryId: string,
  now: Date,
  input: {
    responseStatus: number | null;
    lastErrorCode: string;
  },
): Promise<void> {
  await db
    .update(webhookDeliveries)
    .set({
      status: "DEAD",
      responseStatus: input.responseStatus,
      lastErrorCode: input.lastErrorCode,
      updatedAt: now,
    })
    .where(eq(webhookDeliveries.id, deliveryId));
}

function isRetryableWebhookStatus(status: number): boolean {
  return (
    status === 408 ||
    status === 425 ||
    status === 429 ||
    (status >= 500 && status <= 599)
  );
}

function isUnsafeIpLiteral(hostname: string): boolean {
  const ipVersion = isIP(hostname);

  if (ipVersion === 0) {
    return false;
  }

  if (ipVersion === 4) {
    const parts = hostname.split(".").map((part) => Number.parseInt(part, 10));
    const [first = 0, second = 0] = parts;

    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254) ||
      first === 0
    );
  }

  return (
    hostname === "::1" ||
    hostname.toLowerCase().startsWith("fc") ||
    hostname.toLowerCase().startsWith("fd") ||
    hostname.toLowerCase().startsWith("fe80")
  );
}

export async function findDeliveriesForEvent(
  db: Database,
  requestEventId: string,
): Promise<Array<{ id: string; eventType: string; payload: WebhookPayload }>> {
  const rows = await db
    .select({
      id: webhookDeliveries.id,
      eventType: webhookDeliveries.eventType,
      payload: webhookDeliveries.payload,
    })
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.requestEventId, requestEventId));

  return rows.map((row) => ({
    id: row.id,
    eventType: row.eventType,
    payload: row.payload as WebhookPayload,
  }));
}

export async function hasWebhookSubscriptions(
  db: Database,
  events: string[],
): Promise<boolean> {
  const rows = await db
    .select({ eventType: webhookSubscriptions.eventType })
    .from(webhookSubscriptions)
    .where(inArray(webhookSubscriptions.eventType, events))
    .limit(1);

  return rows.length > 0;
}
