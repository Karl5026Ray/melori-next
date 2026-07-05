import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Disposable / throwaway email domains we reject to cut down on spam.
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com",
  "temp-mail.org", "throwaway.email", "yopmail.com", "trashmail.com",
  "getnada.com", "dispostable.com", "maildrop.cc", "sharklasers.com",
  "fakeinbox.com", "mailnesia.com", "tempinbox.com", "spam4.me",
]);

// RFC-5322-ish practical email check. Rejects obvious garbage and enforces a
// real-looking domain with a TLD. This is a syntax/heuristic gate only.
const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

// POST /api/feedback - "Help us improve" comments from any visitor (no auth).
// Requires name + a valid email + a comment. Inserts via the service role key
// into public.feedback. Includes lightweight anti-spam: honeypot field, length
// limits, disposable-domain block, and a link-count heuristic.
export async function POST(req: NextRequest) {
  // Anonymous feedback form — IP-throttle so bots can't stuff the table.
  // 3 quick / ~1 per minute per IP.
  const rl = rateLimit(`feedback:${clientIp(req)}`, 3, 1 / 60);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Too many submissions. Please wait a moment and try again." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));

    // Honeypot: real users never fill this hidden field. Bots often do.
    if (typeof body.company === "string" && body.company.trim() !== "") {
      // Pretend success so bots don't learn they were caught.
      return NextResponse.json({ ok: true });
    }

    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const comment = String(body.comment ?? "").trim();

    if (!name) {
      return NextResponse.json({ error: "Please enter your name." }, { status: 400 });
    }
    if (name.length > 100) {
      return NextResponse.json({ error: "That name is too long." }, { status: 400 });
    }

    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
      return NextResponse.json({ error: "Please enter a valid email address." }, { status: 400 });
    }
    const domain = email.split("@")[1] ?? "";
    if (DISPOSABLE_DOMAINS.has(domain)) {
      return NextResponse.json({ error: "Please use a permanent email address." }, { status: 400 });
    }

    if (!comment) {
      return NextResponse.json({ error: "Please add a comment." }, { status: 400 });
    }
    if (comment.length < 5) {
      return NextResponse.json({ error: "Your comment is a little short." }, { status: 400 });
    }
    if (comment.length > 2000) {
      return NextResponse.json({ error: "Your comment is too long (2000 char max)." }, { status: 400 });
    }

    // Link-spam heuristic: legit feedback rarely contains many URLs.
    const linkCount = (comment.match(/https?:\/\//gi) ?? []).length;
    if (linkCount > 2) {
      return NextResponse.json({ error: "Too many links in your comment." }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("feedback").insert({
      name,
      email,
      comment,
      source: "about_help_us_improve",
      user_agent: req.headers.get("user-agent") ?? null,
    });

    if (error) {
      console.error("Feedback insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Feedback route error:", err);
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
