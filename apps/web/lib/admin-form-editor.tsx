"use client";

import React, { useState } from "react";

import type { AdminFormDraftEditorView } from "./admin-form-management";
import { AdminSubmitButton } from "./admin-request-action-forms";
import {
  buildFormRuntimeBootstrap,
  formRuntimeFeedbackCss,
} from "./form-runtime-bootstrap";

type SourceTab = "html" | "css" | "javascript";

export function AdminFormEditor({
  draft,
}: {
  draft: AdminFormDraftEditorView;
}) {
  const [activeTab, setActiveTab] = useState<SourceTab>("html");
  const [source, setSource] = useState({
    html: draft.html,
    css: draft.css,
    javascript: draft.javascript,
  });
  const [preview, setPreview] = useState(source);
  const labels: Record<SourceTab, string> = {
    html: "HTML",
    css: "CSS",
    javascript: "JavaScript",
  };

  return (
    <form
      className="admin-form-editor"
      action={`/admin/forms/${encodeURIComponent(draft.publicId)}/versions/${draft.versionNumber}/save`}
      method="post"
    >
      <input type="hidden" name="expectedUpdatedAt" value={draft.updatedAt} />
      <input type="hidden" name="html" value={source.html} />
      <input type="hidden" name="css" value={source.css} />
      <input type="hidden" name="javascript" value={source.javascript} />

      <section className="admin-form-editor-source" aria-label="Draft source">
        <div className="admin-form-editor-tabs" role="tablist">
          {(Object.keys(labels) as SourceTab[]).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              aria-controls="form-source-editor"
              onClick={() => setActiveTab(tab)}
            >
              {labels[tab]}
            </button>
          ))}
        </div>
        <label className="admin-form-source-field">
          <span>{labels[activeTab]} source</span>
          <textarea
            id="form-source-editor"
            value={source[activeTab]}
            spellCheck={false}
            onChange={(event) =>
              setSource((current) => ({
                ...current,
                [activeTab]: event.target.value,
              }))
            }
          />
        </label>
        <p>Each source field is limited to 250 KB.</p>
      </section>

      <section className="admin-form-preview" aria-labelledby="preview-heading">
        <div className="admin-form-preview-heading">
          <div>
            <h2 id="preview-heading">Preview</h2>
            <p>Isolated preview of the current editor contents.</p>
          </div>
          <button
            className="mt-button mt-button-secondary"
            type="button"
            onClick={() => setPreview(source)}
          >
            Refresh preview
          </button>
        </div>
        <iframe
          title={`${draft.formName} draft preview`}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          srcDoc={buildSandboxedPreviewDocument(preview)}
        />
      </section>

      <div className="admin-form-editor-save">
        <AdminSubmitButton>Save draft</AdminSubmitButton>
      </div>
    </form>
  );
}

export function buildSandboxedPreviewDocument(source: {
  html: string;
  css: string;
  javascript: string;
}) {
  const css = source.css.replace(/<\/style/gi, "<\\/style");
  const javascript = source.javascript.replace(/<\/script/gi, "<\\/script");
  const runtimeBootstrap = buildFormRuntimeBootstrap({
    mode: "preview",
  }).replace(/<\/script/gi, "<\\/script");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${formRuntimeFeedbackCss}\n${css}</style>
<script>${runtimeBootstrap}</script>
</head>
<body>
${source.html}
<script>${javascript}</script>
</body>
</html>`;
}
