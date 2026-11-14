import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rate-limit";
import { getRequestMembership } from "@/lib/membership-server";
import { getResend, MELORI_FROM, MELORI_REPLY_TO } from "@/lib/email";
import {
  OPEN_LETTER_ROOM_PATH,
  OPEN_LETTER_SLUG,
  mergeSignature,
  validateOpenLetterSignature,
  type ExistingSignature,
} from "@/lib/openLetter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// /api/open-letter — signatures for Karl's open letter (/open-letter).
//
// PUBLIC ON PURPOSE: most signers arrive from Facebook with no Melori account.
// /api/* is outside the proxy matcher and nothing here checks auth. If
// the caller IS signed in (bearer token) the row is linked to their user id.
//
// public.open_letter_signatures is service-role only (migration 103: RLS on, no
// client policies), so every read and write goes through getSupabaseAdmin.
// GET returns only the count — never names or emails.

const COLUMNS = "id, user_id, story, source, has_partner_in_process";

export async function GET() {
  try {
    const { count, error } = await getSupabaseAdmin()
      .from("open_letter_signatures")
      .select("id", { count: "exact", head: true })
      .eq("letter", OPEN_LETTER_SLUG);
    if (error) throw error;
    return NextResponse.json(
      { count: count ?? 0 },
      { headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } },
    );
  } catch (err) {
    console.error("open-letter count error:", err);
    return NextResponse.json({ count: null }, { status: 200 });
  }
}

export async function POST(req: NextRequest) {
  // Anonymous form, so IP-based: 5 quick, then ~1 a minute per IP.
  const rl = rateLimit(`open-letter:${clientIp(req)}`, 5, 1 / 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many tries from this location. Please wait a minute." },
      { status: 429, headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() } },
    );
  }

  const body = await req.json().catch(() => ({}));

  // Honeypot: a hidden field real people never fill.
  if (body && typeof body.company === "string" && body.company.trim() !== "") {
    return NextResponse.json({ ok: true });
  }

  const parsed = validateOpenLetterSignature(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const input = parsed.value;

  let isNew = false;
  try {
    const membership = await getRequestMembership(req).catch(() => null);
    const userId = membership?.userId ?? null;
    const supabase = getSupabaseAdmin();

    const write = async (): Promise<{ error: { code?: string; message: string } | null }> => {
      const { data: existing, error: readErr } = await supabase
        .from("open_letter_signatures")
        .select(COLUMNS)
        .eq("letter", OPEN_LETTER_SLUG)
        .eq("email", input.email)
        .maybeSingle();
      if (readErr) return { error: readErr };

      const prior = (existing as ExistingSignature | null) ?? null;
      if (!prior) {
        isNew = true;
        const row = mergeSignature(null, input, userId);
        const { error } = await supabase.from("open_letter_signatures").insert(row);
        return { error };
      }
      // Already signed. Knowing an email proves nothing, so an anonymous repeat
      // must not overwrite someone's name, city or private story: it is a
      // silent no-op. Only the signed-in owner of the row can update it.
      if (!userId || prior.user_id !== userId) return { error: null };
      const row = mergeSignature(prior, input, userId);
      const { error } = await supabase
        .from("open_letter_signatures")
        .update(row)
        .eq("id", (existing as ExistingSignature).id);
      return { error };
    };

    let { error } = await write();
    // Two submits racing on the same email: the loser hits the unique index.
    if (error?.code === "23505") ({ error } = await write());

    if (error) {
      console.error("open-letter write error:", error);
      return NextResponse.json(
        { error: "Could not save your signature. Please try again." },
        { status: 500 },
      );
    }
  } catch (err) {
    console.error("open-letter exception:", err);
    return NextResponse.json(
      { error: "Could not save your signature. Please try again." },
      { status: 500 },
    );
  }

  if (isNew) await sendConfirmation(input.email, input.first_name);
  // Same answer whether or not this email had signed before: the response must
  // not reveal who has signed (count-only privacy promise).
  return NextResponse.json({ ok: true });
}

// Best effort: a Resend failure is logged, never returned to the signer.
async function sendConfirmation(email: string, firstName: string) {
  const resend = getResend();
  if (!resend) {
    console.warn("open-letter: RESEND_API_KEY not set, skipping confirmation");
    return;
  }
  const roomUrl = `https://melorimusic.org${OPEN_LETTER_ROOM_PATH}`;
  const letterUrl = "https://melorimusic.org/open-letter";
  const text = [
    `Thank you, ${firstName}.`,
    "",
    "Your name is on the open letter for the Citizen Accountability Clause. Your name is never shown publicly; we only share the total count, and the signatures go to the lawmakers named in the letter.",
    "",
    `Join the conversation with other couples in MM Spaces: ${roomUrl}`,
    `Share the letter: ${letterUrl}`,
    "",
    "We'll email you when the letter is delivered.",
    "",
    "— Karl Ray, Melori",
  ].join("\n");
  const html = `<p>Thank you, ${escapeHtml(firstName)}.</p>
<p>Your name is on the open letter for the <strong>Citizen Accountability Clause</strong>. Your name is never shown publicly; we only share the total count, and the signatures go to the lawmakers named in the letter.</p>
<p><a href="${roomUrl}">Join the conversation with other couples in MM Spaces</a></p>
<p><a href="${letterUrl}">Share the letter</a></p>
<p>We'll email you when the letter is delivered.</p>
<p>— Karl Ray, Melori</p>`;
  try {
    const result = await resend.emails.send({
      from: MELORI_FROM,
      to: [email],
      replyTo: MELORI_REPLY_TO,
      subject: "You signed the Citizen Accountability Clause letter",
      html,
      text,
    });
    if (result.error) console.error("open-letter email failed:", result.error);
  } catch (err) {
    console.error("open-letter email failed:", err);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
