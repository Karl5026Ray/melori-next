import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Same verified sender the app already uses for its Resend emails
// (see /api/donate/verify). Domain melorimusic.org is verified in Resend.
const FROM_ADDRESS = "support@melorimusic.org";
const REPLY_TO = "karlrayphotography@gmail.com";

// Resend allows at most 50 recipients per send call.
const CHUNK_SIZE = 50;

async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return false;
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

async function loadRecipients(): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("contact_signups")
    .select("email")
    .not("email", "is", null)
    .eq("consent_email", true);

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  for (const row of data ?? []) {
    const email = String((row as any).email ?? "").trim().toLowerCase();
    if (email) seen.add(email);
  }
  return [...seen];
}

// GET — eligible recipient count (admin-guarded).
export async function GET(req: NextRequest) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }

  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const recipients = await loadRecipients();
    return NextResponse.json({ total: recipients.length });
  } catch (err: any) {
    console.error("email-blast count error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Could not load recipients" },
      { status: 500 },
    );
  }
}

// POST — send the blast (admin-guarded).
export async function POST(req: NextRequest) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }

  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    return NextResponse.json(
      { error: "Email sending is not configured" },
      { status: 503 },
    );
  }

  const body = await req.json().catch(() => ({}));
  const subject = String(body.subject ?? "").trim();
  const message = String(body.body ?? "").trim();
  const fromName = String(body.fromName ?? "").trim() || "MELORI MUSIC";

  if (!subject || !message) {
    return NextResponse.json(
      { error: "Subject and message are required." },
      { status: 400 },
    );
  }
  // Cap subject + body to sane sizes. Resend accepts large bodies but our
  // admin UI is a normal textarea; a runaway paste shouldn't be able to
  // ship a multi-MB email to the entire list.
  if (subject.length > 200) {
    return NextResponse.json(
      { error: "Subject must be 200 characters or fewer." },
      { status: 400 },
    );
  }
  if (message.length > 20_000) {
    return NextResponse.json(
      { error: "Message body is too long (max 20,000 characters)." },
      { status: 400 },
    );
  }

  let recipients: string[];
  try {
    recipients = await loadRecipients();
  } catch (err: any) {
    console.error("email-blast recipient load error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Could not load recipients" },
      { status: 500 },
    );
  }

  const total = recipients.length;
  if (total === 0) {
    return NextResponse.json({ sent: 0, failed: 0, total: 0 });
  }

  const escapeHtml = (s: string) =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const footerText =
    "\n\n—\nYou're receiving this because you opted in to updates from MELORI MUSIC.\nReply STOP to unsubscribe.";
  const footerHtml =
    '<p style="margin-top:24px;color:#888;font-size:12px;">You\'re receiving this because you opted in to updates from MELORI MUSIC.<br/>Reply STOP to unsubscribe.</p>';

  const text = message + footerText;
  const html =
    `<div>${escapeHtml(message).replace(/\r?\n/g, "<br/>")}</div>` + footerHtml;

  const from = `${fromName} <${FROM_ADDRESS}>`;

  const { Resend } = await import("resend");
  const resend = new Resend(resendKey);

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
    const chunk = recipients.slice(i, i + CHUNK_SIZE);
    try {
      const { error } = await resend.emails.send({
        from,
        // `to` is the sender itself; real recipients go in BCC so addresses
        // are never exposed to each other.
        to: [FROM_ADDRESS],
        bcc: chunk,
        replyTo: REPLY_TO,
        subject,
        text,
        html,
      });
      if (error) {
        console.error("email-blast chunk send error:", error);
        failed += chunk.length;
      } else {
        sent += chunk.length;
      }
    } catch (err) {
      console.error("email-blast chunk exception:", err);
      failed += chunk.length;
    }
  }

  return NextResponse.json({ sent, failed, total });
}
