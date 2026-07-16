import React from "react";

import { getPublicRequestTrackingData } from "@/lib/public-request-api";
import { getPublicRequestApiDependencies } from "@/lib/public-request-api-dependencies";
import { PublicRequestTrackingView } from "@/lib/public-request-tracking-view";

export default async function PublicRequestTrackingPage(input: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await input.params;
  const tracking = await getPublicRequestTrackingData(
    getPublicRequestApiDependencies(),
    publicId,
  );

  return <PublicRequestTrackingView publicId={publicId} tracking={tracking} />;
}
