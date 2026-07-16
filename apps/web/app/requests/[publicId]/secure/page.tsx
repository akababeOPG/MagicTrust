import React from "react";
import { cookies } from "next/headers";

import {
  consumerAccessSessionCookieName,
  getPublicSecureAccessData,
} from "@/lib/public-request-api";
import { getPublicRequestApiDependencies } from "@/lib/public-request-api-dependencies";
import { PublicSecureAccessView } from "@/lib/public-secure-access-view";

export default async function PublicSecureSessionPage(input: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await input.params;
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(consumerAccessSessionCookieName)?.value;
  const access = await getPublicSecureAccessData(
    getPublicRequestApiDependencies(),
    publicId,
    sessionToken,
  );

  return <PublicSecureAccessView publicId={publicId} access={access} />;
}
