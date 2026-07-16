type SubmitPrivacyRequestFormResult =
  | {
      ok: true;
      publicId: string;
      requestStatus: string;
    }
  | {
      ok: false;
      message: string;
    };

export async function submitPrivacyRequestForm(
  formData: FormData,
  sourceUrl: string | undefined,
  resetForm: () => void,
): Promise<SubmitPrivacyRequestFormResult> {
  const response = await fetch("/api/public/requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      type: formData.get("type"),
      firstName: formData.get("firstName"),
      lastName: formData.get("lastName"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      message: formData.get("message"),
      website: formData.get("website"),
      sourceUrl,
    }),
  });

  const body = await response.json();

  if (!response.ok) {
    return {
      ok: false,
      message: body.error?.message ?? "Request could not be submitted.",
    };
  }

  resetForm();

  return {
    ok: true,
    publicId: body.request.publicId,
    requestStatus: body.request.status,
  };
}
