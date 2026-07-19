export async function POST() {
  return Response.json(
    {
      error: {
        code: "PASSWORD_LOGIN_REQUIRED",
        message: "Password authentication is required.",
      },
    },
    { status: 410 },
  );
}
