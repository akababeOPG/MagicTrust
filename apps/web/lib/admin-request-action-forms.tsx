"use client";

import { useFormStatus } from "react-dom";

export function AdminSubmitButton({
  children,
  variant = "primary",
}: {
  children: string;
  variant?: "primary" | "secondary" | "destructive";
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={buttonVariantClassName(variant)}
      type="submit"
      disabled={pending}
    >
      {pending ? "Submitting..." : children}
    </button>
  );
}

export function AdminConfirmSubmitButton({
  children,
  confirmation,
  variant = "destructive",
}: {
  children: string;
  confirmation: string;
  variant?: "primary" | "secondary" | "destructive";
}) {
  const { pending } = useFormStatus();

  return (
    <button
      className={buttonVariantClassName(variant)}
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

function buttonVariantClassName(
  variant: "primary" | "secondary" | "destructive",
): string | undefined {
  return variant === "primary" ? undefined : `mt-button-${variant}`;
}
