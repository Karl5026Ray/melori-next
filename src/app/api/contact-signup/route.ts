import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/contact-signup — Free-tier contact capture. Open to everyone (no
// gating). Inserts into public.contact_signups. RLS is ON for that table, so the
// insert must run with the service role key (getSupabaseAdmin), never the anon
// key. At least one of email/phone is required (also enforced by a table CHECK).
export async function POST(req: NextRequest) {
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
    const { error } = await supabase.from("contact_signups").insert({
      name: name || null,
      email: email || null,
      phone: phone || null,
      consent_sms: consentSms,
      consent_email: consentEmail,
      source: "free_tier",
    });

    if (error) {
      console.error("Contact signup insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("Contact signup exception:", err);
    return NextResponse.json(
      { error: err?.message ?? "Could not save your info. Please try again." },
      { status: 500 },
    );
  }
}
