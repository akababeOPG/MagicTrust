import {
  createPublicFormSubmissionApi,
  createPublicFormSubmissionDependencies,
  publicFormSubmissionCorsHeaders,
  withPublicFormSubmissionCors,
} from "@/lib/public-form-submissions";

export function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: publicFormSubmissionCorsHeaders,
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return withPublicFormSubmissionCors(
    await createPublicFormSubmissionApi(
      createPublicFormSubmissionDependencies(),
    ).create(request, slug),
  );
}
