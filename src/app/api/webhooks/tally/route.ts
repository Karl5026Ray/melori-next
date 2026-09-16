// src/app/api/webhooks/tally/route.ts
//
// Receives Tally form submissions. One endpoint serves every Tally form; the
// form is mapped to a funnel via TALLY_FORM_MAP so adding a form is a config
// change, not a code change.
//
// Security: Tally signs each request with HMAC-SHA256 over the RAW body,
// base64-encoded, in the `tally-signature` header. We verify before parsing.
// Without this, anyone who learns the URL can stuff the lead list.
//
// Requires migration 081 (plain unique indexes + upsert_contact_signup).

import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getResend, MELORI_FROM, MELORI_REPLY_TO } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type FormType =
  | "woe_first_look"
  | "melori_waitlist"
  | "purchase"
  | "casting"
  | "other";

const FORM_TYPES = new Set<FormType>([
  "woe_first_look",
  "melori_waitlist",
  "purchase",
  "casting",
  "other",
]);

function isFormType(value: unknown): value is FormType {
  return typeof value === "string" && FORM_TYPES.has(value as FormType);
}

// Map Tally formId -> our funnel. e.g. { "wAbC12": "woe_first_look" }
// Parsed defensively: a typo in the env var must not take the endpoint down at
// module load, which would 500 every submission with an opaque error.
export function parseTallyFormMap(raw: string | undefined): Record<string, FormType> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: Record<string, FormType> = {};
    for (const [formId, formType] of Object.entries(parsed)) {
      if (formId.length > 0 && isFormType(formType)) {
        map[formId] = formType;
      }
    }
    return map;
  } catch {
    console.error("TALLY_FORM_MAP is not valid JSON; falling back to {}");
    return {};
  }
}

const TALLY_FORM_MAP: Record<string, FormType> = parseTallyFormMap(process.env.TALLY_FORM_MAP);

type TallyField = {
  key: string;
  label: string;
  type: string;
  value: unknown;
  // Present on DROPDOWN / MULTIPLE_CHOICE / CHECKBOXES: value holds option ids,
  // and the human-readable text lives here.
  options?: Array<{ id: string; text: string }>;
};

type TallyPayload = {
  eventId?: string;
  eventType?: string;
  createdAt?: string;
  data?: {
    responseId?: string;
    submissionId?: string;
    respondentId?: string;
    formId?: string;
    formName?: string;
    fields?: TallyField[];
  };
};

export function dedupeKeyFor(body: TallyPayload): string | null {
  const data = body.data ?? {};
  return data.submissionId ?? data.responseId ?? null;
}

// Tally sends choice answers as option IDs. Resolve them to the label text a
// human actually picked, otherwise every dropdown lands in the DB as a uuid.
function readable(field: TallyField): string {
  const v = field.value;
  if (v == null) return "";
  if (Array.isArray(v)) {
    if (field.options?.length) {
      return v
        .map((id) => field.options?.find((o) => o.id === id)?.text ?? String(id))
        .filter(Boolean)
        .join(", ");
    }
    return v.map((x) => String(x)).join(", ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

// Find a field by label fragment, case-insensitive. Needles are tried in order,
// so pass the most specific first: "full name" before "name", or a consent
// checkbox labelled "Email me updates" will answer a search for "email".
function pick(fields: TallyField[], ...needles: string[]): string {
  for (const needle of needles) {
    const hit = fields.find((f) =>
      (f.label ?? "").toLowerCase().includes(needle.toLowerCase()),
    );
    if (hit) {
      const val = readable(hit);
      if (val) return val;
    }
  }
  return "";
}

function pickByType(fields: TallyField[], type: string): TallyField | undefined {
  return fields.find((f) => f.type === type);
}

// Consent must be an explicit affirmative, matched whole. A substring test
// against /on|1|yes/ marks "None of the above" and "Monthly" as opted in, and
// mailing people who did not opt in is the one bug here with legal teeth.
const AFFIRMATIVE = new Set(["true", "yes", "y", "on", "1", "checked"]);

function verifySignature(rawBody: string, header: string | null): boolean {
  const secret = process.env.TALLY_SIGNING_SECRET;
  // Fail closed. An unverified webhook endpoint is an open spam funnel.
  if (!secret || !header) return false;

  const expected = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("base64");

  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  // Read the raw body FIRST — re-serializing parsed JSON changes the bytes and
  // breaks the signature.
  const rawBody = await req.text();

  if (!verifySignature(rawBody, req.headers.get("tally-signature"))) {
    console.error("Tally webhook: signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let body: TallyPayload;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Malformed JSON" }, { status: 400 });
  }

  const data = body.data ?? {};
  const fields = data.fields ?? [];
  const formId = data.formId ?? "";

  if (!formId) {
    return NextResponse.json({ error: "Missing formId" }, { status: 400 });
  }

  const formType: FormType = TALLY_FORM_MAP[formId] ?? "other";

  // Dedupe key. submissionId is the right one; responseId is the only tolerated
  // fallback. eventId is about the webhook delivery, not the submission itself,
  // so using it would risk collapsing distinct submissions onto one key.
  const dedupeKey = dedupeKeyFor(body);
  if (!dedupeKey) {
    return NextResponse.json(
      { error: "Missing submission identifier" },
      { status: 400 },
    );
  }

  // --- Person -------------------------------------------------------------
  const emailField = pickByType(fields, "INPUT_EMAIL");
  const email = (emailField ? readable(emailField) : pick(fields, "email address", "your email"))
    .trim()
    .toLowerCase()
    .slice(0, 254);

  const name = pick(fields, "full name", "your name", "name").trim().slice(0, 100);
  const phoneField = pickByType(fields, "INPUT_PHONE_NUMBER");
  const phone = (phoneField ? readable(phoneField) : pick(fields, "phone"))
    .trim()
    .slice(0, 30);

  // --- Attribution (Tally HIDDEN_FIELDS) ----------------------------------
  const utm_source = pick(fields, "utm_source").slice(0, 120) || null;
  const utm_medium = pick(fields, "utm_medium").slice(0, 120) || null;
  const utm_campaign = pick(fields, "utm_campaign").slice(0, 120) || null;
  const utm_content = pick(fields, "utm_content").slice(0, 120) || null;
  const utm_term = pick(fields, "utm_term").slice(0, 120) || null;
  const referrer = pick(fields, "referrer").slice(0, 500) || null;
  const landing_path = pick(fields, "landing_path").slice(0, 500) || null;

  // --- Segment + money ----------------------------------------------------
  const audience_segment =
    pick(fields, "which best describes", "segment", "i am a", "role").slice(0, 120) ||
    null;

  const paymentField = pickByType(fields, "PAYMENT");
  let amount_cents: number | null = null;
  let currency: string | null = null;
  if (paymentField && paymentField.value && typeof paymentField.value === "object") {
    const pv = paymentField.value as Record<string, unknown>;
    const amt = Number(pv.amount);
    if (Number.isFinite(amt)) {
      // Tally reports a decimal amount; store integer cents.
      amount_cents = Math.round(amt * 100);
    }
    currency = typeof pv.currency === "string" ? pv.currency : null;
  }

  // Explicit opt-in only. We never infer marketing consent from the fact that
  // somebody filled in a form.
  const consentRaw = pick(fields, "keep me posted", "email me", "subscribe", "consent");
  const consentEmail = AFFIRMATIVE.has(consentRaw.trim().toLowerCase());

  const supabase = getSupabaseAdmin();

  // --- Write the event ----------------------------------------------------
  // onConflict on submission_id: Tally retries, and a slow-but-successful
  // response still gets retried. .select() tells us whether this was a real
  // insert or a swallowed duplicate — with DO NOTHING, a duplicate returns no
  // rows. That is what gates the follow-up email.
  const { data: inserted, error: subError } = await supabase
    .from("form_submissions")
    .upsert(
      {
        event_id: body.eventId ?? null,
        submission_id: dedupeKey,
        respondent_id: data.respondentId ?? null,
        form_id: formId,
        form_name: data.formName ?? null,
        form_type: formType,
        audience_segment,
        email: email || null,
        name: name || null,
        phone: phone || null,
        utm_source,
        utm_medium,
        utm_campaign,
        utm_content,
        utm_term,
        referrer,
        landing_path,
        amount_cents,
        currency,
        payload: body as unknown as Record<string, unknown>,
      },
      { onConflict: "submission_id", ignoreDuplicates: true },
    )
    .select("id");

  if (subError) {
    console.error("Tally webhook: form_submissions insert failed", subError);
    // 500 so Tally retries. The submission is not lost.
    return NextResponse.json({ error: "Storage failed" }, { status: 500 });
  }

  const result = await afterSubmissionInsert({
    inserted,
    email,
    formType,
    name,
    onNewSubmission: async () => {
      // --- Keep one master contact list ------------------------------------
      // Through the RPC, not a plain upsert: a plain upsert writes every column
      // in the payload, so a returning contact who fills a form with no name
      // field and no consent checkbox would have their name blanked and their
      // email consent silently revoked. See migration 081.
      if (email) {
        const { error: contactError } = await supabase.rpc("upsert_contact_signup", {
          p_email: email,
          p_name: name || null,
          p_phone: phone || null,
          p_consent: consentEmail,
          p_source: `tally:${formType}`,
        });
        if (contactError) {
          // Non-fatal: the submission is already safely stored. Log and move on
          // rather than making Tally retry a write that already succeeded.
          console.error("Tally webhook: contact upsert failed", contactError);
        }
      }
    },
  });

  return NextResponse.json(result.body, { status: result.status });
}

// ---------------------------------------------------------------------------

type PostInsertResult =
  | { status: 200; body: { ok: true } }
  | { status: 200; body: { ok: true; duplicate: true } };

export async function afterSubmissionInsert(opts: {
  inserted: Array<{ id: string }> | null | undefined;
  email: string;
  formType: FormType;
  name: string;
  onNewSubmission: () => Promise<void>;
  sendFollowUpImpl?: typeof sendFollowUp;
}): Promise<PostInsertResult> {
  const isNewSubmission = (opts.inserted?.length ?? 0) > 0;

  if (!isNewSubmission) {
    // A retry of something we already stored. Everything below has already run.
    return { status: 200, body: { ok: true, duplicate: true } };
  }

  await opts.onNewSubmission();

  // --- Follow-up ----------------------------------------------------------
  // Awaited, NOT fire-and-forget. On Vercel the function is frozen as soon as
  // the response is returned, so a detached `void sendFollowUp(...)` usually
  // never resolves and the email silently never sends.
  //
  // Awaiting is safe here specifically because of the duplicate gate above: if
  // Resend is slow enough that Tally gives up and retries, the retry hits the
  // `duplicate: true` early return and no second email goes out. A send is
  // ~300ms against a 10s Tally timeout, so this is not a real latency risk.
  // If heavier post-processing ever lands here, move it to waitUntil() from
  // @vercel/functions rather than detaching the promise.
  if (opts.email) {
    await (opts.sendFollowUpImpl ?? sendFollowUp)({
      formType: opts.formType,
      email: opts.email,
      name: opts.name,
    }).catch((err) => console.error("Tally webhook: follow-up email failed", err));
  }

  return { status: 200, body: { ok: true } };
}

const FOLLOW_UPS: Record<
  FormType,
  { subject: string; heading: string; body: string } | null
> = {
  woe_first_look: {
    subject: "You're on the WOE first-look list",
    heading: "You're in.",
    body: "You'll be among the first to see WOE — early looks at the series, casting news, and the pilot when it's ready to screen. Nothing else, no noise.",
  },
  melori_waitlist: {
    subject: "Welcome to the Melori waitlist",
    heading: "Welcome to Melori.",
    body: "Melori is a home for independent musicians, photographers, storytellers and podcasters. You're on the list — I'll reach out as soon as your spot opens up.",
  },
  purchase: {
    subject: "Your Melori order",
    heading: "Thank you.",
    body: "Your payment went through and your download is on its way. If anything looks wrong, just reply to this email — it comes straight to me.",
  },
  casting: {
    subject: "We got your submission",
    heading: "Submission received.",
    body: "Thanks for putting yourself forward. We're reviewing submissions now and will be in touch if you're a fit for a role.",
  },
  other: null,
};

async function sendFollowUp(opts: {
  formType: FormType;
  email: string;
  name: string;
}) {
  const copy = FOLLOW_UPS[opts.formType];
  if (!copy) return;

  const resend = getResend();
  if (!resend) return; // Not configured in this environment; nothing to do.

  const greeting = opts.name ? `Hi ${escapeHtml(opts.name.split(" ")[0])},` : "Hi,";

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">
    <h1 style="font-size:20px;margin:0 0 16px;">${escapeHtml(copy.heading)}</h1>
    <p style="font-size:15px;line-height:1.6;margin:0 0 12px;color:#444;">${greeting}</p>
    <p style="font-size:15px;line-height:1.6;margin:0 0 24px;color:#444;">${escapeHtml(copy.body)}</p>
    <p style="font-size:13px;line-height:1.6;color:#666;margin:0;">— Karl Ray, Melori Music</p>
  </div>`;

  const { error } = await resend.emails.send({
    from: MELORI_FROM,
    to: [opts.email],
    replyTo: MELORI_REPLY_TO,
    subject: copy.subject,
    html,
    // MELORI_REPLY_TO is a bare address (see src/lib/email.ts), so a mailto
    // unsubscribe is safe to interpolate. No List-Unsubscribe-Post: that
    // advertises one-click, which needs an HTTPS endpoint we do not have yet.
    headers: {
      "List-Unsubscribe": `<mailto:${MELORI_REPLY_TO}?subject=unsubscribe>`,
    },
  });
  if (error) throw new Error(error.message ?? "Resend send failed");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
