import type { RequestStatus } from "./types";

export const requestDueSoonWindowMs = 48 * 60 * 60 * 1000;

export const requestSlaStates = [
  "NO_DUE_DATE",
  "ON_TRACK",
  "DUE_SOON",
  "OVERDUE",
  "COMPLETED",
] as const;

export type RequestSlaState = (typeof requestSlaStates)[number];

const terminalStatuses = new Set<RequestStatus>([
  "SUCCESS",
  "REJECTED",
  "CANCELLED",
]);
const dayMs = 24 * 60 * 60 * 1000;

export function deriveRequestSlaState(input: {
  status: RequestStatus;
  dueAt: Date | null;
  now: Date;
}): RequestSlaState {
  if (terminalStatuses.has(input.status)) return "COMPLETED";
  if (!input.dueAt) return "NO_DUE_DATE";
  if (input.dueAt.getTime() < input.now.getTime()) return "OVERDUE";
  if (input.dueAt.getTime() <= input.now.getTime() + requestDueSoonWindowMs) {
    return "DUE_SOON";
  }

  return "ON_TRACK";
}

export function formatDueDate(
  dueAt: Date,
  style: "short" | "full" = "full",
): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    ...(style === "full" ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(dueAt);
}

export function formatDueRelative(dueAt: Date, now: Date): string {
  const differenceMs = dueAt.getTime() - now.getTime();

  if (differenceMs < 0) {
    const days = Math.max(1, Math.ceil(Math.abs(differenceMs) / dayMs));
    return `Overdue by ${days} ${days === 1 ? "day" : "days"}`;
  }

  const dueDay = Date.UTC(
    dueAt.getUTCFullYear(),
    dueAt.getUTCMonth(),
    dueAt.getUTCDate(),
  );
  const currentDay = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const days = Math.round((dueDay - currentDay) / dayMs);

  if (days === 0) return "Due today";
  if (days === 1) return "Due tomorrow";
  return `Due in ${days} days`;
}
