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

export function AdminConfirmSubmitButton({
  children,
  confirmation,
}: {
  children: string;
  confirmation: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(confirmation)) event.preventDefault();
      }}
    >
      {pending ? "Submitting..." : children}
    </button>
  );
}
