import { cookies } from "next/headers";

import {
  consumerAccessSessionCookieName,
  downloadPublicAttachmentForConsumer,
} from "@/lib/public-request-api";
import { getPublicRequestApiDependencies } from "@/lib/public-request-api-dependencies";

export async function GET(
  _request: Request,
  context: { params: Promise<{ publicId: string; attachmentId: string }> },
) {
  const { publicId, attachmentId } = await context.params;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(consumerAccessSessionCookieName)?.value;

  return downloadPublicAttachmentForConsumer(
    getPublicRequestApiDependencies(),
    publicId,
    attachmentId,
    sessionToken,
  );
}
