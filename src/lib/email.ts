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

// ---------------------------------------------------------------------------
// Unread direct-message digest
// ---------------------------------------------------------------------------

export type DmDigestThread = {
  // Who wrote. Display name, falling back to username upstream.
  from: string;
  // How many unread messages from that person in this thread.
  count: number;
  // Short preview of the most recent one. Already truncated + escaped upstream.
  preview: string;
  // True when this is a first-contact request the member has not accepted yet.
  isRequest: boolean;
  // Deep link to the thread, or to the requests inbox for a pending request.
  href: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dmDigestHtml(opts: {
  greetingName: string;
  threads: DmDigestThread[];
  inboxUrl: string;
  unsubscribeUrl: string;
}): string {
  const rows = opts.threads
    .map((t) => {
      const label = t.isRequest
        ? `<span style="display:inline-block;background:#f3e8ff;color:#7c3aed;font-size:11px;font-weight:700;padding:2px 8px;border-radius:9999px;margin-left:8px;">MESSAGE REQUEST</span>`
        : t.count > 1
          ? `<span style="color:#666;font-size:13px;font-weight:400;"> · ${t.count} new</span>`
          : "";
      const body = t.preview
        ? `<p style="font-size:14px;line-height:1.5;color:#444;margin:6px 0 0;">${escapeHtml(t.preview)}</p>`
        : `<p style="font-size:14px;line-height:1.5;color:#888;margin:6px 0 0;font-style:italic;">No message text — they just opened the conversation.</p>`;
      return `
      <a href="${t.href}" style="display:block;text-decoration:none;border:1px solid #ececec;border-radius:12px;padding:14px 16px;margin:0 0 12px;">
        <p style="font-size:15px;font-weight:600;color:#1a1a1a;margin:0;">${escapeHtml(t.from)}${label}</p>
        ${body}
      </a>`;
    })
    .join("");

  const total = opts.threads.reduce((n, t) => n + Math.max(t.count, 1), 0);
  const heading =
    opts.threads.length === 1
      ? `You have a new message on Melori`
      : `You have ${total} new messages on Melori`;

  return `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
    <h1 style="font-size:20px;margin:0 0 8px;">${heading}</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 20px;color:#444;">Hi ${escapeHtml(opts.greetingName)}, here's what's waiting in your Melori inbox.</p>
    ${rows}
    <p style="margin:20px 0 28px;">
      <a href="${opts.inboxUrl}" style="display:inline-block;background:#7c3aed;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:9999px;">Open your inbox</a>
    </p>
    <p style="font-size:13px;line-height:1.6;color:#666;margin:0 0 8px;">— Karl Ray, Melori Music</p>
    <p style="font-size:12px;line-height:1.6;color:#999;margin:16px 0 0;border-top:1px solid #ececec;padding-top:12px;">
      You're getting this because email notifications are on for your Melori account.
      <a href="${opts.unsubscribeUrl}" style="color:#999;">Turn them off</a>.
    </p>
  </div>`;
}

// Send one digest covering everything unread for a single member. Returns the
// Resend message id. Throws if Resend is unconfigured or the send fails, so the
// cron can log the failure and leave the rows unstamped for the next run.
export async function sendDmDigestEmail(opts: {
  to: string;
  greetingName: string;
  threads: DmDigestThread[];
  inboxUrl: string;
  unsubscribeUrl: string;
}): Promise<string> {
  const resend = getResend();
  if (!resend) throw new Error("RESEND_API_KEY is not configured");

  const total = opts.threads.reduce((n, t) => n + Math.max(t.count, 1), 0);
  const onlyRequests = opts.threads.every((t) => t.isRequest);
  const subject =
    opts.threads.length === 1 && opts.threads[0]
      ? opts.threads[0].isRequest
        ? `${opts.threads[0].from} wants to message you on Melori`
        : `New message from ${opts.threads[0].from} on Melori`
      : onlyRequests
        ? `${opts.threads.length} people want to message you on Melori`
        : `${total} new messages on Melori`;

  const { data, error } = await resend.emails.send({
    from: MELORI_FROM,
    to: [opts.to],
    replyTo: MELORI_REPLY_TO,
    subject,
    html: dmDigestHtml(opts),
    // One-click unsubscribe. Gmail and Yahoo require this on bulk mail, and it
    // keeps the notification stream out of spam as volume grows.
    headers: {
      "List-Unsubscribe": `<${opts.unsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  });
  if (error) throw new Error(error.message ?? "Resend send failed");
  return data?.id ?? "";
}
