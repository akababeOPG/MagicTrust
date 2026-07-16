import { getEmailFrom, getResendApiKey } from "@magictrust/config";
import { Resend } from "resend";

export type SendEmailInput = {
  to: string;
  subject: string;
  body: string;
};

export type SendEmailResult = {
  provider: "resend";
  providerMessageId: string;
};

export type EmailProvider = {
  readonly provider: SendEmailResult["provider"];
  sendEmail(input: SendEmailInput): Promise<SendEmailResult>;
};

export function createResendEmailProvider(): EmailProvider {
  return {
    provider: "resend",
    async sendEmail(input) {
      const apiKey = getResendApiKey();
      const from = getEmailFrom();

      if (!apiKey) {
        throw new Error("RESEND_API_KEY is required for email sending.");
      }

      if (!from) {
        throw new Error("EMAIL_FROM is required for email sending.");
      }

      const resend = new Resend(apiKey);
      const result = await resend.emails.send({
        from,
        to: input.to,
        subject: input.subject,
        text: input.body,
      });

      if (result.error || !result.data?.id) {
        throw new Error("Email provider failed to send the message.");
      }

      return {
        provider: "resend",
        providerMessageId: result.data.id,
      };
    },
  };
}
