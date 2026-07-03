import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_SECRET =
  process.env.ADMIN_JWT_SECRET || "melori-admin-fallback-secret";

// SMS body cap. A single SMS segment is 160 GSM-7 chars; longer messages are
// split into multiple segments by the carrier. Twilio accepts up to 1600 chars.
const MAX_LENGTH = 1600;

// Twilio has no native bulk endpoint on this REST API — one request per
// recipient. Send in small batches so we don't hammer the rate limit.
const BATCH_SIZE = 10;

const UNSUBSCRIBE_NOTE = "\n\nReply STOP to unsubscribe.";

async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

// Normalize a raw phone value to E.164 (US assumption). Returns null if it
// can't be normalized to a plausible number.
function normalizePhone(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("+")) {
    const digits = trimmed.slice(1).replace(/\D/g, "");
    return digits ? `+${digits}` : null;
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}

async function loadRecipients(): Promise<string[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("contact_signups")
    .select("phone")
    .not("phone", "is", null)
    .eq("consent_sms", true);

  if (error) throw new Error(error.message);

  const seen = new Set<string>();
  for (const row of data ?? []) {
    const phone = normalizePhone(String((row as any).phone ?? ""));
    if (phone) seen.add(phone);
  }
  return [...seen];
}

// GET — eligible recipient count (admin-guarded).
export async function GET(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const recipients = await loadRecipients();
    return NextResponse.json({ total: recipients.length });
  } catch (err: any) {
    console.error("sms-blast count error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Could not load recipients" },
      { status: 500 },
    );
  }
}

// POST — send the blast (admin-guarded).
export async function POST(req: NextRequest) {
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    return NextResponse.json({ error: "Twilio not configured" }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const message = String(body.message ?? "").trim();

  if (!message) {
    return NextResponse.json(
      { error: "Message is required." },
      { status: 400 },
    );
  }
  if (message.length > MAX_LENGTH) {
    return NextResponse.json(
      { error: `Message must be ${MAX_LENGTH} characters or fewer.` },
      { status: 400 },
    );
  }

  let recipients: string[];
  try {
    recipients = await loadRecipients();
  } catch (err: any) {
    console.error("sms-blast recipient load error:", err);
    return NextResponse.json(
      { error: err?.message ?? "Could not load recipients" },
      { status: 500 },
    );
  }

  const total = recipients.length;
  if (total === 0) {
    return NextResponse.json({ sent: 0, failed: 0, total: 0 });
  }

  const text = message + UNSUBSCRIBE_NOTE;
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const auth =
    "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const sendOne = async (to: string): Promise<boolean> => {
    const form = new URLSearchParams({ To: to, From: fromNumber, Body: text });
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          Authorization: auth,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        console.error(`sms-blast send failed for ${to}:`, res.status, detail);
        return false;
      }
      return true;
    } catch (err) {
      console.error(`sms-blast send exception for ${to}:`, err);
      return false;
    }
  };

  let sent = 0;
  let failed = 0;

  for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
    const batch = recipients.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(sendOne));
    for (const r of results) {
      if (r.status === "fulfilled" && r.value) sent += 1;
      else failed += 1;
    }
  }

  return NextResponse.json({ sent, failed, total });
}
