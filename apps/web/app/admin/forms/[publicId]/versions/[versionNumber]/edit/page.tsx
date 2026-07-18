import { unstable_noStore as noStore } from "next/cache";
import Link from "next/link";
import { notFound } from "next/navigation";
import React from "react";

import { requireAdminRole } from "@/lib/admin-auth";
import {
  createAdminFormDependencies,
  getAdminFormDraftEditor,
} from "@/lib/admin-form-management";
import { AdminFormEditor } from "../../../../../../../lib/admin-form-editor";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminFormEditorPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string; versionNumber: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireAdminRole(["ADMIN"]);
  if (session instanceof Response) notFound();
  noStore();
  const { publicId, versionNumber } = await params;
  const parsedVersion = Number(versionNumber);
  if (!Number.isSafeInteger(parsedVersion) || parsedVersion < 1) notFound();
  const draft = await getAdminFormDraftEditor(
    publicId,
    parsedVersion,
    createAdminFormDependencies(),
  );
  if (!draft) notFound();
  const messages = await searchParams;
  return (
    <main className="admin-page admin-form-editor-page">
      <header className="admin-header">
        <div>
          <p className="eyebrow">Draft v{draft.versionNumber}</p>
          <h1>Edit {draft.formName}</h1>
          <p>
            Update source, refresh the isolated preview, then save the draft.
          </p>
        </div>
        <Link href={`/admin/forms/${encodeURIComponent(draft.publicId)}`}>
          Back to form
        </Link>
      </header>
      {first(messages?.success) ? (
        <div className="mt-feedback mt-feedback-success" role="status">
          {first(messages?.success)}
        </div>
      ) : null}
      {first(messages?.error) ? (
        <div className="mt-feedback mt-feedback-error" role="alert">
          {first(messages?.error)}
        </div>
      ) : null}
      <AdminFormEditor draft={draft} />
    </main>
  );
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
