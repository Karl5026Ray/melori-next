import { Resend } from "resend";

// Central Resend config. The melorimusic.org domain is verified in Resend and
// this is the same verified sender the rest of the app uses (see
// /api/donate/verify and /api/admin/email-blast).
export const MELORI_FROM = "Melori Music <support@melorimusic.org>";
export const MELORI_REPLY_TO = "karlrayphotography@gmail.com";

export function getResend(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function setPasswordHtml(opts: {
  heading: string;
  intro: string;
  link: string;
  buttonLabel: string;
}): string {
  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
    <h1 style="font-size:20px;margin:0 0 16px;">${opts.heading}</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;">${opts.intro}</p>
    <p style="margin:0 0 28px;">
      <a href="${opts.link}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:9999px;">${opts.buttonLabel}</a>
    </p>
    <p style="font-size:13px;line-height:1.6;color:#666;margin:0 0 8px;">If the button doesn't work, copy and paste this link into your browser:</p>
    <p style="font-size:13px;line-height:1.6;color:#7c3aed;word-break:break-all;margin:0 0 24px;">${opts.link}</p>
    <p style="font-size:13px;line-height:1.6;color:#666;margin:0;">— Karl Ray, Melori Music</p>
  </div>`;
}

// Send a "set your password" / activation email carrying a Supabase recovery
// link. Returns the Resend message id on success. Throws if Resend is not
// configured or the send fails so callers can surface / log it.
export async function sendSetPasswordEmail(opts: {
  to: string;
  link: string;
  subject: string;
  heading: string;
  intro: string;
  buttonLabel: string;
}): Promise<string> {
  const resend = getResend();
  if (!resend) throw new Error("RESEND_API_KEY is not configured");
  const { data, error } = await resend.emails.send({
    from: MELORI_FROM,
    to: [opts.to],
    replyTo: MELORI_REPLY_TO,
    subject: opts.subject,
    html: setPasswordHtml({
      heading: opts.heading,
      intro: opts.intro,
      link: opts.link,
      buttonLabel: opts.buttonLabel,
    }),
  });
  if (error) throw new Error(error.message ?? "Resend send failed");
  return data?.id ?? "";
}
