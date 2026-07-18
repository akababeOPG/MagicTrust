"use client";

import React, { useState } from "react";

export function CopyEmbedSnippetButton({ snippet }: { snippet: string }) {
  const [feedback, setFeedback] = useState<string | null>(null);

  async function copySnippet() {
    try {
      await navigator.clipboard.writeText(snippet);
      setFeedback("Snippet copied.");
    } catch {
      setFeedback("Copy failed. Select the snippet and copy it manually.");
    }
  }

  return (
    <div className="admin-embed-copy-action">
      <button
        className="mt-button mt-button-secondary"
        type="button"
        onClick={copySnippet}
      >
        Copy snippet
      </button>
      {feedback ? (
        <span className="admin-embed-copy-feedback" role="status">
          {feedback}
        </span>
      ) : null}
    </div>
  );
}
