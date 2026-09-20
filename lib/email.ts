import { Resend } from "resend";

export interface SendArgs {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function sendBriefEmail({ from, to, subject, text, html }: SendArgs): Promise<void> {
  const resend = new Resend(requireEnv("RESEND_KEY"));

  // The SDK reports failures in `error` rather than throwing, so an unchecked
  // call would look like a successful send while nothing was delivered.
  const { data, error } = await resend.emails.send({ from, to, subject, text, html });

  if (error) {
    throw new Error(`Resend failed to send: ${error.name} — ${error.message}`);
  }
  if (!data?.id) {
    throw new Error("Resend returned no message id; treating as a failed send.");
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
