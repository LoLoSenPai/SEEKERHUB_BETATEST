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
  const safeAppOrigin = escapeHtml(new URL(input.actionUrl).origin);
  const result = await resend.emails.send({
    from: env.EMAIL_FROM,
    to: input.to,
    replyTo: env.EMAIL_REPLY_TO,
    subject: input.subject,
    text: `${input.text}\n\n${input.actionLabel}: ${input.actionUrl}`,
    html: `<!doctype html><html><body style="margin:0;background:#f3f6fb;color:#0f172a;font-family:Arial,Helvetica,sans-serif">
      <div style="display:none;max-height:0;overflow:hidden">${safeText}</div>
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f6fb;padding:32px 16px">
        <tr><td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dbe3ef;border-radius:24px">
            <tr><td style="padding:32px">
              <p style="margin:0 0 22px;letter-spacing:.2em;font-size:11px;font-weight:700;text-transform:uppercase;color:#4263eb">SeekerHub by LoLo Labs</p>
              <h1 style="margin:0 0 16px;font-size:26px;line-height:1.25">${safeSubject}</h1>
              <p style="margin:0 0 24px;line-height:1.65;color:#526078">${safeText}</p>
              <p style="margin:0 0 24px"><a href="${safeActionUrl}" style="display:inline-block;padding:13px 20px;border-radius:999px;background:#0f172a;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none">${safeActionLabel}</a></p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#778399">This secure link opens ${safeAppOrigin}. If you did not request it, you can safely ignore this email.</p>
            </td></tr>
          </table>
          <p style="margin:18px 0 0;font-size:11px;color:#8792a5">Transactional account email from SeekerHub.</p>
        </td></tr>
      </table>
    </body></html>`,
  });

  if (result.error) throw new Error(`Email delivery failed: ${result.error.message}`);
}
