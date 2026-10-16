import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { getRequestMembership } from "@/lib/membership-server";
import { getResend, MELORI_FROM, MELORI_REPLY_TO } from "@/lib/email";
import {
  adminNotifyEmail,
  confirmationEmail,
  mergeSignup,
  validateAndroidBetaSignup,
  type ExistingSignup,
} from "@/lib/androidBeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/android-beta — Android beta-tester signup from /android.
//
// PUBLIC ON PURPOSE: most testers have no Melori account yet. /api/* is outside
// the proxy matcher, and this handler never calls requireAuth. If the caller IS
// signed in (bearer token), the row is linked to their user id.
//
// public.android_beta_signups is service-role only (migration 097: RLS on, no
// client policies), so every read and write here goes through getSupabaseAdmin.
//
// Idempotent: the same email twice updates one row (see mergeSignup) and still
// answers 200, so a double-tap or a repeat visit never errors.
//
// Emails are best effort: a Resend failure is logged, never returned. They go
// out only when the signup is new (or a removed tester asks again): a repeat
// submit from someone already pending/invited would otherwise get a second
// "you're on the list" mail and ping the admin inbox for nothing.

const COLUMNS = "id, email, name, country, user_id, status, source";

export async function POST(req: NextRequest) {
  // Anonymous form, so IP-based: 5 quick, then ~1 a minute per IP.
  const rl = rateLimit(`android-beta:${clientIp(req)}`, 5, 1 / 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many tries from this location. Please wait a minute." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  const body = await req.json().catch(() => ({}));

  // Honeypot: a hidden field real people never fill.
  if (body && typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const parsed = validateAndroidBetaSignup(body);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }
  const input = parsed.value;

  let isNew = false;
  try {
    const membership = await getRequestMembership(req).catch(() => null);
    const userId = membership?.userId ?? null;
    const supabase = getSupabaseAdmin();

    const write = async (): Promise<{ error: { code?: string; message: string } | null }> => {
      const { data: existing, error: readErr } = await supabase
        .from("android_beta_signups")
        .select(COLUMNS)
        .eq("email", input.email)
        .maybeSingle();
      if (readErr) return { error: readErr };

      const row = mergeSignup((existing as ExistingSignup | null) ?? null, input, userId);
      if (!existing) {
        isNew = true;
        const { error } = await supabase.from("android_beta_signups").insert(row);
        return { error };
      }
      isNew = (existing as ExistingSignup).status === "removed";
      const { error } = await supabase
        .from("android_beta_signups")
        .update(row)
        .eq("id", (existing as ExistingSignup).id);
      return { error };
    };

    let { error } = await write();
    // Two submits racing on the same email: the loser hits the unique index.
    // Run once more — it will now find the row and update it.
    if (error?.code === "23505") ({ error } = await write());

    if (error) {
      console.error("android-beta write error:", error);
      return NextResponse.json(
        { error: "Could not save your signup. Please try again." },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error("android-beta exception:", err);
    return NextResponse.json(
      { error: "Could not save your signup. Please try again." },
      { status: 500 },
    );
  }

  if (isNew) await sendEmails(input);
  return NextResponse.json({ ok: true });
}

async function sendEmails(
  input: { email: string; name: string | null; country: string | null; source: string | null },
) {
  const resend = getResend();
  if (!resend) {
    console.warn("android-beta: RESEND_API_KEY not set, skipping emails");
    return;
  }
  const confirm = confirmationEmail({ name: input.name, email: input.email });
  const notify = adminNotifyEmail({ ...input, isNew: true });
  const results = await Promise.allSettled([
    resend.emails.send({
      from: MELORI_FROM,
      to: [input.email],
      replyTo: MELORI_REPLY_TO,
      subject: confirm.subject,
      html: confirm.html,
      text: confirm.text,
    }),
    // MELORI_REPLY_TO is the platform admin inbox the other admin alerts go to
    // (sendLiveRoomReportEmail in src/lib/email.ts).
    resend.emails.send({
      from: MELORI_FROM,
      to: [MELORI_REPLY_TO],
      subject: notify.subject,
      html: notify.html,
      text: notify.text,
    }),
  ]);
  for (const r of results) {
    if (r.status === "rejected") console.error("android-beta email failed:", r.reason);
    else if (r.value.error) console.error("android-beta email failed:", r.value.error);
  }
}
