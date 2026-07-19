import {
  createPublicFormSubmissionApi,
  createPublicFormSubmissionDependencies,
} from "@/lib/public-form-submissions";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  return createPublicFormSubmissionApi(
    createPublicFormSubmissionDependencies(),
  ).create(request, slug);
}
