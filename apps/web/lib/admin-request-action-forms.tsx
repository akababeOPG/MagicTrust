"use client";

import { useFormStatus } from "react-dom";

export function AdminSubmitButton({ children }: { children: string }) {
  const { pending } = useFormStatus();

  return (
    <button type="submit" disabled={pending}>
      {pending ? "Submitting..." : children}
    </button>
  );
}
