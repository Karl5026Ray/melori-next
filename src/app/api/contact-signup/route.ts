import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contact-signup — Free-tier contact capture. Open to everyone (no
// gating). Writes to public.contact_signups. RLS is ON for that table, so the
// write must run with the service role key (getSupabaseAdmin), never the anon
// key. At least one of email/phone is required (also enforced by a table CHECK).
//
// Migration 081 put a unique index on contact_signups(email) so the Tally
// webhook could upsert. That turned a repeat signup here — previously a silent
// duplicate row — into SQLSTATE 23505. So an email signup now goes through
// upsert_contact_signup(), the same merge the webhook uses: idempotent, and it
// cannot blank a name or drop a consent we already hold.
//
// A phone-only signup still inserts directly. There is no unique index on
// phone, so there is nothing to conflict with, and the merge function keys on
// email and would no-op on a null one.
export async function POST(req: NextRequest) {
  // Anonymous contact-capture, so use IP-based rate limiting to blunt bot
  // floods. 3 quick / ~1 per minute per IP.
  const rl = rateLimit(`contact-signup:${clientIp(req)}`, 3, 1 / 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many signups from this location. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));

    // Honeypot: real users never fill this hidden field. Bots often do. Reply
    // with a cheerful 200 so bots don't learn they were caught.
    if (typeof body.company === "string" && body.company.trim() !== "") {
      return NextResponse.json({ ok: true });
    }

    const name = String(body.name ?? "").trim().slice(0, 100);
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 254);
    const phone = String(body.phone ?? "").trim().slice(0, 30);
    const consentSms = Boolean(body.consent_sms);
    const consentEmail = Boolean(body.consent_email);

    if (!email && !phone) {
      return NextResponse.json(
        { error: "Please provide an email or a phone number." },
        { status: 400 },
      );
    }

    // Light syntax gates. Not exhaustive — the DB CHECK enforces the shape
    // constraint and we mostly want to reject obviously bogus payloads.
    if (email && !/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(email)) {
      return NextResponse.json(
        { error: "Please enter a valid email address." },
        { status: 400 },
      );
    }
    if (phone && !/^[+()\-\s0-9]{7,30}$/.test(phone)) {
      return NextResponse.json(
        { error: "Please enter a valid phone number." },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    const { error } = email
      ? await supabase.rpc("upsert_contact_signup", {
          p_email: email,
          p_name: name || null,
          p_phone: phone || null,
          p_consent: consentEmail,
          p_source: "free_tier",
          p_consent_sms: consentSms,
        })
      : await supabase.from("contact_signups").insert({
          name: name || null,
          email: null,
          phone: phone || null,
          consent_sms: consentSms,
          consent_email: consentEmail,
          source: "free_tier",
        });

    if (error) {
      console.error("Contact signup write error:", error);
      // Never hand a raw Postgres message to the browser — it names tables,
      // columns and index names to anyone who can POST this endpoint.
      return NextResponse.json(
        { error: "Could not save your info. Please try again." },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Contact signup exception:", err);
    return NextResponse.json(
      { error: "Could not save your info. Please try again." },
      { status: 500 },
    );
  }
}
