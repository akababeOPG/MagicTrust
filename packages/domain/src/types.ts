export const requestTypes = [
  "DATA_ACCESS",
  "DATA_DELETION",
  "DO_NOT_CONTACT",
  "UNSUBSCRIBE",
  "GENERAL_INQUIRY",
] as const;

export type RequestType = (typeof requestTypes)[number];

export const requestStatuses = [
  "SUBMITTED",
  "PENDING_VERIFICATION",
  "VERIFIED",
  "PROCESSING",
  "WAITING_FOR_REQUESTER",
  "SUCCESS",
  "REJECTED",
  "CANCELLED",
] as const;

export type RequestStatus = (typeof requestStatuses)[number];

export const actorTypes = [
  "CONSUMER",
  "INTERNAL_USER",
  "API_CLIENT",
  "SYSTEM",
] as const;

export type ActorType = (typeof actorTypes)[number];

export const commentVisibilities = ["PUBLIC", "INTERNAL"] as const;

export type CommentVisibility = (typeof commentVisibilities)[number];

export type RequestEventType =
  | "REQUEST_CREATED"
  | "STATUS_CHANGED"
  | "PUBLIC_COMMENT_ADDED"
  | "INTERNAL_COMMENT_ADDED";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

export type Requester = {
  id: string;
  externalId: string | null;
};

export type PrivacyRequest = {
  id: string;
  publicId: string;
  requesterId: string;
  type: RequestType;
  status: RequestStatus;
  submittedData: JsonObject;
  mutableData: JsonObject;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

export type RequestEvent = {
  id: string;
  privacyRequestId: string;
  type: RequestEventType;
  actorType: ActorType;
  actorId: string | null;
  data: JsonObject;
  createdAt: Date;
};

export type RequestComment = {
  id: string;
  requestId: string;
  visibility: CommentVisibility;
  body: string;
  actorType: ActorType;
  actorId: string | null;
  createdAt: Date;
};
