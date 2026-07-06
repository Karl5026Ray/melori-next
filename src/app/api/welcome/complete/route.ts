import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { buildMembershipUpdate } from "@/lib/membership-sync";
import { verifyCheckoutSession, findAuthUserByEmail } from "@/lib/welcome";
import { sendSetPasswordEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/welcome/complete
// Body: { session_id: string, display_name?: string, password?: string }
//
// The post-payment account step. Verifies the Stripe Checkout Session
// server-side (entitlement comes from Stripe, never the query params), then
// create-or-links the Supabase account and applies the paid tier using the
// same shared logic as the members webhook.
//
// Idempotency: safe to call repeatedly for the same session. A brand-new buyer
// gets an auth user created with their chosen password. If the email already
// has an account (including a double-submit that just created one), we never
// overwrite the password — instead we (re)apply the membership tier and email a
// Supabase recovery link so they can set a password and finish activating.

const USERNAME_RE = /^[a-z0-9_.]{3,30}$/;

function normalizeUsername(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 30);
  return cleaned.length >= 3 ? cleaned : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pickAvailableUsername(
  admin: any,
  candidate: string | null,
  ownId: string,
): Promise<string | null> {
  if (!candidate) return null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const trial =
      attempt === 0
        ? candidate
        : `${candidate.slice(0, 24)}_${Math.random().toString(36).slice(2, 6)}`;
    const { data: taken } = await admin
      .from("profiles")
      .select("id")
      .eq("username", trial)
      .neq("id", ownId)
      .maybeSingle();
    if (!taken) return trial;
  }
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  const displayNameRaw =
    typeof body.display_name === "string" ? body.display_name.trim().slice(0, 100) : "";
  const password = typeof body.password === "string" ? body.password : "";

  const verified = await verifyCheckoutSession(sessionId);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: verified.status });
  }
  if (!verified.paid) {
    return NextResponse.json(
      { error: "This purchase has not completed yet." },
      { status: 402 },
    );
  }
  const email = verified.email?.trim().toLowerCase();
  if (!email) {
    return NextResponse.json(
      { error: "No email is associated with this purchase." },
      { status: 400 },
    );
  }

  const admin = getSupabaseAdmin();
  const artist = verified.tier === "artist";

  const membershipUpdate = buildMembershipUpdate(
    {
      tier: verified.tier,
      interval: verified.interval,
      customerId: verified.customerId,
      subscriptionId: verified.subscriptionId,
      status: "active",
      currentPeriodEnd: verified.currentPeriodEnd,
      canceled: false,
    },
    {},
  );

  const existing = await findAuthUserByEmail(admin, email);

  // ---- Existing account: never reset password from here. Apply tier + email a
  // recovery link so the buyer can set a password and finish activating. ----
  if (existing) {
    await applyMembershipToProfile(admin, existing.id, membershipUpdate, displayNameRaw);

    let emailSent = false;
    try {
      const { data: linkData, error: linkErr } =
        await admin.auth.admin.generateLink({
          type: "recovery",
          email,
          options: { redirectTo: `${SITE_URL}/reset-password` },
        });
      const link = linkData?.properties?.action_link;
      if (!linkErr && link) {
        await sendSetPasswordEmail({
          to: email,
          link,
          subject: "Finish activating your Melori membership",
          heading: "You're almost there",
          intro:
            "Thanks for your purchase! You already have a Melori account for this email. Set your password to sign in and start using your membership.",
          buttonLabel: "Set your password",
        });
        emailSent = true;
      }
    } catch (err) {
      console.error("welcome/complete recovery email error", err);
    }

    return NextResponse.json({
      mode: "existing",
      email,
      tier: verified.tier,
      artist,
      emailSent,
    });
  }

  // ---- New buyer: create the auth user with the chosen password. ----
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 },
    );
  }

  const username = normalizeUsername(displayNameRaw) ?? normalizeUsername(email.split("@")[0]);
  if (displayNameRaw && username && !USERNAME_RE.test(username)) {
    return NextResponse.json({ error: "Invalid display name." }, { status: 400 });
  }

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: displayNameRaw || null,
      username,
    },
  });

  // Race / double-submit: another request already created this user. Fall back
  // to the existing-account path so the caller still gets a consistent result.
  if (createErr || !created?.user) {
    const now = await findAuthUserByEmail(admin, email);
    if (now) {
      await applyMembershipToProfile(admin, now.id, membershipUpdate, displayNameRaw);
      return NextResponse.json({
        mode: "existing",
        email,
        tier: verified.tier,
        artist,
        emailSent: false,
      });
    }
    console.error("welcome/complete createUser error", createErr);
    return NextResponse.json(
      { error: "Could not create your account. Please try again." },
      { status: 500 },
    );
  }

  const userId = created.user.id;
  const finalUsername = await pickAvailableUsername(admin, username, userId);

  const { error: upsertErr } = await admin.from("profiles").upsert(
    {
      id: userId,
      username: finalUsername,
      display_name: displayNameRaw || null,
      full_name: displayNameRaw || null,
      ...membershipUpdate,
    },
    { onConflict: "id" },
  );
  if (upsertErr) {
    console.error("welcome/complete profile upsert error", upsertErr);
    return NextResponse.json(
      { error: "Account created but profile setup failed. Please contact support." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    mode: "created",
    email,
    tier: verified.tier,
    artist,
  });
}

// Apply membership fields to an existing profile row, merging against the
// current row so we never clobber an admin role or an existing username. Fills
// display_name/full_name only when blank.
async function applyMembershipToProfile(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string,
  membershipUpdate: Record<string, unknown>,
  displayNameRaw: string,
): Promise<void> {
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role, membership_tier, stripe_customer_id, stripe_subscription_id, display_name, full_name, username")
    .eq("id", userId)
    .maybeSingle();

  // Re-derive against the live row so admins are preserved and we don't drop an
  // already-active higher tier.
  const merged = {
    ...membershipUpdate,
    membership_tier:
      (membershipUpdate.membership_tier as string | null) ??
      (profile?.membership_tier ?? null),
    stripe_customer_id:
      (membershipUpdate.stripe_customer_id as string | null) ??
      (profile?.stripe_customer_id ?? null),
    stripe_subscription_id:
      (membershipUpdate.stripe_subscription_id as string | null) ??
      (profile?.stripe_subscription_id ?? null),
    role:
      profile?.role === "admin"
        ? "admin"
        : (membershipUpdate.role as string) ?? profile?.role ?? "free",
  } as Record<string, unknown>;

  if (displayNameRaw && !profile?.display_name) merged.display_name = displayNameRaw;
  if (displayNameRaw && !profile?.full_name) merged.full_name = displayNameRaw;

  if (profile) {
    await admin.from("profiles").update(merged).eq("id", userId);
  } else {
    await admin.from("profiles").upsert({ id: userId, ...merged }, { onConflict: "id" });
  }
}
