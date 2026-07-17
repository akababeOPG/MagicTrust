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

export const communicationChannels = ["EMAIL"] as const;

export type CommunicationChannel = (typeof communicationChannels)[number];

export const communicationDirections = ["OUTBOUND"] as const;

export type CommunicationDirection = (typeof communicationDirections)[number];

export const communicationStatuses = ["PENDING", "SENT", "FAILED"] as const;

export type CommunicationStatus = (typeof communicationStatuses)[number];

export type RequestEventType =
  | "CUSTOM_EVENT"
  | "REQUEST_CREATED"
  | "STATUS_CHANGED"
  | "PUBLIC_COMMENT_ADDED"
  | "INTERNAL_COMMENT_ADDED"
  | "PUBLIC_ATTACHMENT_ADDED"
  | "INTERNAL_ATTACHMENT_ADDED"
  | "ATTACHMENT_DOWNLOADED"
  | "EMAIL_SENT"
  | "EMAIL_FAILED"
  | "CONSUMER_ACCESS_LINK_SENT"
  | "CONSUMER_ACCESS_TOKEN_USED"
  | "CONSUMER_ACCESS_SESSION_CREATED"
  | "CONSUMER_ACCESS_SESSION_USED"
  | "CONSUMER_ATTACHMENT_DOWNLOADED"
  | "IDENTITY_VERIFICATION_SENT"
  | "IDENTITY_VERIFIED"
  | "CONSUMER_NOTIFICATION_SENT"
  | "CONSUMER_NOTIFICATION_FAILED"
  | "REQUEST_DATA_UPDATED";

export type RequestEventCategory = "BUILT_IN" | "CUSTOM";

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
  category?: RequestEventCategory;
  customType?: string | null;
  visibility?: CommentVisibility;
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

export type RequestAttachment = {
  id: string;
  requestId: string;
  visibility: CommentVisibility;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  storageProvider: string;
  storageKey: string;
  checksum: string;
  actorType: ActorType;
  actorId: string | null;
  createdAt: Date;
};

export type RequestCommunication = {
  id: string;
  requestId: string;
  channel: CommunicationChannel;
  direction: CommunicationDirection;
  recipient: string;
  subject: string;
  body: string;
  provider: string;
  providerMessageId: string | null;
  status: CommunicationStatus;
  errorMessage: string | null;
  actorType: ActorType;
  actorId: string | null;
  createdAt: Date;
  sentAt: Date | null;
};

export type RequestAccessToken = {
  id: string;
  requestId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};

export type RequestAccessSession = {
  id: string;
  requestId: string;
  sessionHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  lastSeenAt: Date | null;
};

export type RequestIdentityVerificationToken = {
  id: string;
  requestId: string;
  tokenHash: string;
  expiresAt: Date;
  usedAt: Date | null;
  createdAt: Date;
};
