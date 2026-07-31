import { Resend } from "resend";
import { getServerEnv } from "@/src/lib/env";

type EmailInput = {
  to: string;
  subject: string;
  text: string;
  actionLabel: string;
  actionUrl: string;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

export async function sendTransactionalEmail(input: EmailInput) {
  const env = getServerEnv();

  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("RESEND_API_KEY and EMAIL_FROM must be configured in production.");
    }
    console.info(`[email:development] ${input.subject}: ${input.actionUrl}`);
    return;
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const safeSubject = escapeHtml(input.subject);
  const safeText = escapeHtml(input.text);
  const safeActionLabel = escapeHtml(input.actionLabel);
  const safeActionUrl = escapeHtml(input.actionUrl);
  const result = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    replyTo: env.EMAIL_REPLY_TO,
    subject: input.subject,
    text: `${input.text}\n\n${input.actionLabel}: ${input.actionUrl}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#111827">
      <p style="letter-spacing:.18em;font-size:12px;text-transform:uppercase">SeekerHub</p>
      <h1 style="font-size:24px">${safeSubject}</h1>
      <p style="line-height:1.6;color:#475569">${safeText}</p>
      <p><a href="${safeActionUrl}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#0f172a;color:white;text-decoration:none">${safeActionLabel}</a></p>
      <p style="font-size:12px;color:#64748b">If you did not request this email, you can ignore it.</p>
    </div>`,
  });

  if (result.error) throw new Error(`Email delivery failed: ${result.error.message}`);
}
