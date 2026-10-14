// src/lib/androidBeta.ts
//
// Pure helpers for the Android beta-tester flow (/android, /api/android-beta,
// /admin/android-testers). No Supabase, no Resend, no Next imports, so the same
// module is safe in client components, route handlers and tsx tests.
//
// WHY THIS FLOW EXISTS: Google Play closed testing for org.melorimusic.app uses
// an email list ("Melori Android Testers"). Testers previously failed because
// they had to join a Google Group on their phone first. Now a tester leaves the
// Gmail their Play Store uses, an admin pastes the pending emails into the Play
// Console list, and one button emails everyone the two links below.

export const ANDROID_APP_ID = "org.melorimusic.app";

/** Step 1 — the closed-testing opt-in page. Must be opened while signed in to
 *  the same Google account the Play Store uses. */
export const PLAY_TESTING_URL = `https://play.google.com/apps/testing/${ANDROID_APP_ID}`;

/** Step 2 — the store listing, which shows Install once the opt-in has landed. */
export const PLAY_INSTALL_URL = `https://play.google.com/store/apps/details?id=${ANDROID_APP_ID}`;

/** The address every Melori email comes from (MELORI_FROM in src/lib/email.ts).
 *  Shown on the success screen so testers know what to look for. A test pins
 *  that the two agree. */
export const MELORI_SENDER_ADDRESS = "support@melorimusic.org";

export const SIGNUP_STATUSES = ["pending", "added", "invited", "removed"] as const;
export type SignupStatus = (typeof SIGNUP_STATUSES)[number];

export const COUNTRY_OPTIONS = ["United States", "Nigeria", "Other"] as const;

export type AndroidBetaSignupInput = {
  email: string;
  name: string | null;
  country: string | null;
  source: string | null;
};

export type ValidationResult =
  | { ok: true; value: AndroidBetaSignupInput }
  | { ok: false; error: string };

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

export function normalizeEmail(raw: unknown): string {
  return String(raw ?? "").trim().toLowerCase().slice(0, 254);
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email);
}

/** Play Store accounts are almost always @gmail.com (or the legacy
 *  @googlemail.com). Anything else gets a gentle hint, never a rejection —
 *  Workspace accounts can use the Play Store too. */
export function isGmail(email: string): boolean {
  return /@(gmail|googlemail)\.com$/i.test(email.trim());
}

/** ?src= is free text from a URL. Keep it to a short slug so it can't carry
 *  anything interesting into the admin page or the notification email. */
export function sanitizeSource(raw: unknown): string | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 64);
  return s || null;
}

function cleanText(raw: unknown, max: number): string | null {
  const s = String(raw ?? "")
    .replace(/[\u0000-\u001f\u007f<>]/g, "")
    .trim()
    .slice(0, max);
  return s || null;
}

/**
 * Validate a POST body from /android. `country` is one of COUNTRY_OPTIONS; when
 * it is "Other" the optional `country_other` free text is stored instead (we
 * add countries to the Play Console as people ask for them).
 */
export function validateAndroidBetaSignup(body: unknown): ValidationResult {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;

  const email = normalizeEmail(b.email);
  if (!email) return { ok: false, error: "Please enter the Gmail your Play Store uses." };
  if (!isValidEmail(email)) return { ok: false, error: "Please enter a valid email address." };

  if (b.has_android !== true) {
    return { ok: false, error: "This beta is for Android phones only." };
  }

  const name = cleanText(b.name, 100);

  let country: string | null = null;
  const pick = String(b.country ?? "").trim();
  if ((COUNTRY_OPTIONS as readonly string[]).includes(pick)) {
    country = pick === "Other" ? (cleanText(b.country_other, 80) ?? "Other") : pick;
  }

  return { ok: true, value: { email, name, country, source: sanitizeSource(b.source) } };
}

export type ExistingSignup = {
  id: string;
  email: string;
  name: string | null;
  country: string | null;
  user_id: string | null;
  status: SignupStatus;
  source: string | null;
};

export type SignupWrite = {
  email: string;
  name: string | null;
  country: string | null;
  user_id: string | null;
  status: SignupStatus;
  source: string | null;
};

/**
 * What to write for a (re-)submission. Idempotent: submitting the same thing
 * twice produces the same row.
 *
 *  - a new email becomes a 'pending' row;
 *  - a repeat never blanks a name/country/user we already hold, and keeps the
 *    first source (that's the one that got them here);
 *  - it never moves an 'added' or 'invited' tester backwards to 'pending' —
 *    that would put them in the next invite batch and email them twice;
 *  - a 'removed' tester who signs up again is asking again, so they go back to
 *    'pending' for the admin to look at.
 */
export function mergeSignup(
  existing: ExistingSignup | null,
  incoming: AndroidBetaSignupInput,
  userId: string | null,
): SignupWrite {
  if (!existing) {
    return {
      email: incoming.email,
      name: incoming.name,
      country: incoming.country,
      user_id: userId,
      status: "pending",
      source: incoming.source,
    };
  }
  return {
    email: existing.email,
    name: incoming.name ?? existing.name,
    country: incoming.country ?? existing.country,
    user_id: existing.user_id ?? userId,
    status: existing.status === "removed" ? "pending" : existing.status,
    source: existing.source ?? incoming.source,
  };
}

/** The clipboard payload for Play Console's tester list: comma-separated. */
export function pendingEmailsForPlayConsole(
  rows: { email: string; status: SignupStatus }[],
): string {
  const seen = new Set<string>();
  for (const r of rows) {
    if (r.status === "pending") seen.add(r.email.trim().toLowerCase());
  }
  return [...seen].join(", ");
}

export function countByStatus(
  rows: { status: SignupStatus }[],
): Record<SignupStatus, number> {
  const counts: Record<SignupStatus, number> = { pending: 0, added: 0, invited: 0, removed: 0 };
  for (const r of rows) if (r.status in counts) counts[r.status] += 1;
  return counts;
}

// ---------------------------------------------------------------------------
// Banner: Android web visitors who are not already inside the app.

const NATIVE_MARKERS = ["MeloriApp", ANDROID_APP_ID];

export function isAndroidWebUserAgent(ua: string | null | undefined): boolean {
  if (typeof ua !== "string" || !/Android/i.test(ua)) return false;
  return !NATIVE_MARKERS.some((m) => ua.includes(m));
}

export function isIPhoneUserAgent(ua: string | null | undefined): boolean {
  return typeof ua === "string" && /iPhone|iPad|iPod/.test(ua);
}

export const BANNER_DISMISS_KEY = "melori.androidBetaBanner.dismissed";

export function shouldShowAndroidBetaBanner(opts: {
  userAgent: string | null | undefined;
  pathname: string | null | undefined;
  dismissed: boolean;
  nativeApp?: boolean;
}): boolean {
  if (opts.dismissed || opts.nativeApp) return false;
  const p = opts.pathname ?? "";
  if (p === "/android" || p.startsWith("/android/") || p.startsWith("/admin")) return false;
  return isAndroidWebUserAgent(opts.userAgent);
}

// ---------------------------------------------------------------------------
// Emails. Plain, short, and the same look as the rest of src/lib/email.ts.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const WRAP_OPEN =
  '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a;">';
const P = 'style="font-size:15px;line-height:1.6;margin:0 0 14px;"';
const SMALL = 'style="font-size:13px;line-height:1.6;color:#666;margin:0 0 8px;"';

function greeting(name: string | null): string {
  return name ? `Hi ${escapeHtml(name)},` : "Hi,";
}

export type EmailContent = { subject: string; html: string; text: string };

/** Sent right after signup. */
export function confirmationEmail(opts: { name: string | null; email: string }): EmailContent {
  const subject = "You're on the Melori Android beta list";
  const text = [
    opts.name ? `Hi ${opts.name},` : "Hi,",
    "",
    `You're on the list for the Melori Android beta with ${opts.email}.`,
    `Within 24 hours you'll get one more email from ${MELORI_SENDER_ADDRESS} with your install link.`,
    "",
    "What we ask: keep the app installed for 14 days and open it a few times a week.",
    "",
    "Questions? Just reply to this email.",
    "— Melori",
  ].join("\n");
  const html = `${WRAP_OPEN}
    <p ${P}>${greeting(opts.name)}</p>
    <p ${P}>You're on the list for the Melori Android beta with <strong>${escapeHtml(opts.email)}</strong>.</p>
    <p ${P}>Within 24 hours you'll get one more email from <strong>${MELORI_SENDER_ADDRESS}</strong> with your install link.</p>
    <p ${P}>What we ask: keep the app installed for 14 days and open it a few times a week.</p>
    <p ${SMALL}>Questions? Just reply to this email.</p>
    <p ${SMALL}>— Melori</p>
  </div>`;
  return { subject, html, text };
}

/** The invite: exactly two steps, then the two things that trip people up. */
export function inviteEmail(opts: { name: string | null; email: string }): EmailContent {
  const subject = "Your Melori Android invite";
  const text = [
    opts.name ? `Hi ${opts.name},` : "Hi,",
    "",
    "You're in. Two steps:",
    "",
    `1) Become a tester: ${PLAY_TESTING_URL}`,
    `2) Install: ${PLAY_INSTALL_URL}`,
    "",
    `Use the same Google account as your Play Store (${opts.email}).`,
    "If Install says not found, wait 15 minutes and try again.",
    "",
    "Please keep the app installed for 14 days and open it a few times a week.",
    "Need help? Just reply to this email.",
    "— Melori",
  ].join("\n");
  const btn = (href: string, label: string) =>
    `<a href="${href}" style="display:inline-block;background:#ff5500;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:10px 20px;border-radius:9999px;">${label}</a>`;
  const html = `${WRAP_OPEN}
    <p ${P}>${greeting(opts.name)}</p>
    <p ${P}>You're in. Two steps:</p>
    <p ${P}><strong>1) Become a tester</strong><br/>${btn(PLAY_TESTING_URL, "Become a tester")}<br/><span style="font-size:13px;color:#666;word-break:break-all;">${PLAY_TESTING_URL}</span></p>
    <p ${P}><strong>2) Install</strong><br/>${btn(PLAY_INSTALL_URL, "Install Melori")}<br/><span style="font-size:13px;color:#666;word-break:break-all;">${PLAY_INSTALL_URL}</span></p>
    <p ${P}>Use the same Google account as your Play Store (<strong>${escapeHtml(opts.email)}</strong>). If Install says not found, wait 15 minutes and try again.</p>
    <p ${SMALL}>Please keep the app installed for 14 days and open it a few times a week.</p>
    <p ${SMALL}>Need help? Just reply to this email.</p>
    <p ${SMALL}>— Melori</p>
  </div>`;
  return { subject, html, text };
}

/** Heads-up to the platform admin inbox. */
export function adminNotifyEmail(opts: {
  email: string;
  name: string | null;
  country: string | null;
  source: string | null;
  isNew: boolean;
}): EmailContent {
  const subject = opts.isNew
    ? `New Android beta signup: ${opts.email}`
    : `Android beta signup (repeat): ${opts.email}`;
  const lines: [string, string][] = [
    ["Email", opts.email],
    ["Name", opts.name ?? "—"],
    ["Country", opts.country ?? "—"],
    ["Source", opts.source ?? "—"],
  ];
  const text = [
    ...lines.map(([k, v]) => `${k}: ${v}`),
    "",
    "Add pending emails to Play Console, then send invites: https://melorimusic.org/admin/android-testers",
  ].join("\n");
  const html = `${WRAP_OPEN}
    <h1 style="font-size:18px;margin:0 0 12px;">${opts.isNew ? "New Android beta signup" : "Android beta signup (already on the list)"}</h1>
    ${lines.map(([k, v]) => `<p style="font-size:15px;line-height:1.6;margin:0 0 6px;"><strong>${k}:</strong> ${escapeHtml(v)}</p>`).join("")}
    <p style="margin:18px 0 0;"><a href="https://melorimusic.org/admin/android-testers" style="display:inline-block;background:#ff5500;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:10px 20px;border-radius:9999px;">Open Android testers</a></p>
  </div>`;
  return { subject, html, text };
}
