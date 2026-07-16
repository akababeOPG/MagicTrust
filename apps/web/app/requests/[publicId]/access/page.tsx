import React from "react";

import { getPublicSecureAccessData } from "@/lib/public-request-api";
import { getPublicRequestApiDependencies } from "@/lib/public-request-api-dependencies";
import { PublicSecureAccessView } from "@/lib/public-secure-access-view";

export default async function PublicSecureAccessPage(input: {
  params: Promise<{ publicId: string }>;
  searchParams?: Promise<{ token?: string }>;
}) {
  const { publicId } = await input.params;
  const searchParams = input.searchParams ? await input.searchParams : {};
  const access = await getPublicSecureAccessData(
    getPublicRequestApiDependencies(),
    publicId,
    searchParams.token,
  );

  return <PublicSecureAccessView publicId={publicId} access={access} />;
}
