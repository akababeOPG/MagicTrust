import { unstable_noStore as noStore } from "next/cache";
import { notFound } from "next/navigation";
import React from "react";

import { PublicFormFrame } from "../../../lib/public-form-frame";
import {
  createPublicFormRenderingDependencies,
  getPublicFormRuntime,
} from "../../../lib/public-form-rendering";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  noStore();
  const { slug } = await params;
  const runtime = await getPublicFormRuntime(
    slug,
    createPublicFormRenderingDependencies(),
  );
  if (!runtime) notFound();
  return <PublicFormFrame slug={slug} />;
}
