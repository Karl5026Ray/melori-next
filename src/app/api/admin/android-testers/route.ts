import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, isAdminGuardFailure } from "@/lib/admin-panel";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getResend, MELORI_FROM, MELORI_REPLY_TO } from "@/lib/email";
import { inviteEmail } from "@/lib/androidBeta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Admin: Android beta testers (/admin/android-testers).
//
// Same gate as /api/admin/mirror — requireAdmin() resolves the caller's
// Supabase bearer token and requires profiles.role === 'admin'.
//
//   GET                                  -> every signup, newest first
//   POST { action: "invite", ids: [...] } -> pending rows in `ids` become
//        'added' (added_at); every 'added' row in `ids` is emailed the two Play
//        links, and each successful send becomes 'invited' (invited_at). A
//        failed send stays 'added' so the next click retries it.
//   POST { action: "remove", id }        -> status 'removed'.
//
// The invite takes explicit ids — the pending rows the admin saw and copied
// into Play Console — rather than "whatever is pending now". Someone who signs
// up between the copy and the click is NOT in the Play list yet, and inviting
// them would send a link that answers "not found".

const MAX_INVITES_PER_CALL = 500;
const BATCH_SIZE = 100;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  const { data, error } = await getSupabaseAdmin()
    .from("android_beta_signups")
    .select("id, email, name, country, user_id, status, created_at, added_at, invited_at, source")
    .order("created_at", { ascending: false })
    .limit(2000);
  if (error) {
    console.error("admin android-testers list error:", error);
    return NextResponse.json({ error: "Could not load testers." }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  const body = await req.json().catch(() => ({}));
  const supabase = getSupabaseAdmin();

  if (body?.action === "remove") {
    const id = String(body.id ?? "");
    if (!UUID_RE.test(id)) return NextResponse.json({ error: "Bad id" }, { status: 400 });
    const { error } = await supabase
      .from("android_beta_signups")
      .update({ status: "removed" })
      .eq("id", id);
    if (error) {
      console.error("admin android-testers remove error:", error);
      return NextResponse.json({ error: "Could not remove." }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body?.action !== "invite") {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const ids: string[] = Array.isArray(body.ids)
    ? [...new Set((body.ids as unknown[]).map(String).filter((s) => UUID_RE.test(s)))]
    : [];
  if (ids.length === 0) return NextResponse.json({ error: "No testers selected." }, { status: 400 });
  if (ids.length > MAX_INVITES_PER_CALL) {
    return NextResponse.json(
      { error: `At most ${MAX_INVITES_PER_CALL} invites per click.` },
      { status: 400 },
    );
  }

  const resend = getResend();
  if (!resend) {
    return NextResponse.json(
      { error: "Email is not configured (RESEND_API_KEY)." },
      { status: 503 },
    );
  }

  // 1. pending -> added. Only rows still pending; never touches removed ones.
  const now = new Date().toISOString();
  const { error: addErr } = await supabase
    .from("android_beta_signups")
    .update({ status: "added", added_at: now })
    .in("id", ids)
    .eq("status", "pending");
  if (addErr) {
    console.error("admin android-testers mark-added error:", addErr);
    return NextResponse.json({ error: "Could not update testers." }, { status: 500 });
  }

  // 2. Everyone in `ids` now 'added' (this click, or a failed send last time).
  const { data: rows, error: readErr } = await supabase
    .from("android_beta_signups")
    .select("id, email, name")
    .in("id", ids)
    .eq("status", "added");
  if (readErr) {
    console.error("admin android-testers read error:", readErr);
    return NextResponse.json({ error: "Could not load testers." }, { status: 500 });
  }

  // Resend's batch endpoint takes up to 100 emails as ONE request, which keeps
  // a big click inside the per-second API rate limit a loop of single sends
  // would trip.
  let sent = 0;
  const failed: string[] = [];
  const list = (rows ?? []) as { id: string; email: string; name: string | null }[];
  for (let i = 0; i < list.length; i += BATCH_SIZE) {
    const chunk = list.slice(i, i + BATCH_SIZE);
    try {
      const { error } = await resend.batch.send(
        chunk.map((row) => {
          const mail = inviteEmail({ name: row.name, email: row.email });
          return {
            from: MELORI_FROM,
            to: [row.email],
            replyTo: MELORI_REPLY_TO,
            subject: mail.subject,
            html: mail.html,
            text: mail.text,
          };
        }),
      );
      if (error) throw new Error(error.message ?? "Resend batch send failed");
      const { error: updErr } = await supabase
        .from("android_beta_signups")
        .update({ status: "invited", invited_at: new Date().toISOString() })
        .in("id", chunk.map((r) => r.id));
      if (updErr) console.error("admin android-testers mark-invited error:", updErr);
      sent += chunk.length;
    } catch (err) {
      console.error("android invite batch failed:", err);
      failed.push(...chunk.map((r) => r.email));
    }
  }

  return NextResponse.json({ ok: true, sent, failed });
}
