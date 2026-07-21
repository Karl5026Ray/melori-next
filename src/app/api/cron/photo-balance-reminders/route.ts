import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getResend, MELORI_FROM, MELORI_REPLY_TO } from "@/lib/email";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client reminders repeat every 3 days until the balance is paid.
const CLIENT_REMINDER_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
const SITE_ORIGIN = "https://melorimusic.org";

function formatMoney(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// GET/POST /api/cron/photo-balance-reminders
// Runs daily. Finds bookings that are marked `completed` but still have an
// outstanding balance (price_cents > deposit_cents and balance_paid = false),
// and emails Karl a single digest so he remembers to collect the balance.
//
// Each booking is reminded once: we stamp balance_reminder_sent_at after
// including it, and skip bookings already stamped. (If Karl generates a fresh
// balance link later, the balance flow is unaffected; this is purely a nudge.)
//
// Auth mirrors the other crons: shared CRON_SECRET via x-cron-secret or
// Authorization: Bearer. We never trust x-vercel-cron alone.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();

  // Completed bookings, balance not paid, not yet reminded.
  const { data: rows, error } = await supabase
    .from("photo_bookings")
    .select(
      "id, photographer_id, client_name, client_email, starts_at, deposit_cents, balance_cents, balance_paid, photo_services(name, price_cents)",
    )
    .eq("status", "completed")
    .eq("balance_paid", false)
    .is("balance_reminder_sent_at", null)
    .order("starts_at", { ascending: true });

  if (error) {
    console.error("photo-balance-reminders query failed", error.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }

  // Keep only bookings where a real balance is owed.
  type Row = {
    id: string;
    photographer_id: string;
    client_name: string | null;
    client_email: string | null;
    starts_at: string | null;
    deposit_cents: number | null;
    balance_cents: number | null;
    photo_services: { name?: string; price_cents?: number } | { name?: string; price_cents?: number }[] | null;
  };

  const owed = ((rows ?? []) as Row[])
    .map((r) => {
      const svc = Array.isArray(r.photo_services) ? r.photo_services[0] : r.photo_services;
      const price = Number.isInteger(svc?.price_cents) ? (svc?.price_cents as number) : 0;
      const deposit = Number.isInteger(r.deposit_cents) ? (r.deposit_cents as number) : 0;
      // Prefer an explicitly recorded balance; else fall back to price - deposit.
      const balance = (r.balance_cents ?? 0) > 0 ? (r.balance_cents as number) : Math.max(price - deposit, 0);
      return {
        id: r.id,
        photographerId: r.photographer_id,
        clientName: r.client_name ?? "Client",
        clientEmail: r.client_email ?? "",
        startsAt: r.starts_at,
        serviceName: svc?.name ?? "Photography session",
        balance,
      };
    })
    .filter((r) => r.balance > 0);

  if (owed.length === 0) {
    return NextResponse.json({ ok: true, reminders: 0 });
  }

  // Group by photographer so each owner gets their own digest. Look up the
  // owner email from auth (profiles has no email column).
  const byPhotographer = new Map<string, typeof owed>();
  for (const r of owed) {
    const list = byPhotographer.get(r.photographerId) ?? [];
    list.push(r);
    byPhotographer.set(r.photographerId, list);
  }

  const resend = getResend();
  let emailsSent = 0;

  for (const [photographerId, items] of byPhotographer.entries()) {
    let toEmail = MELORI_REPLY_TO; // safe default: Karl
    try {
      const { data: authUser } = await supabase.auth.admin.getUserById(photographerId);
      if (authUser?.user?.email) toEmail = authUser.user.email;
    } catch {
      // fall back to MELORI_REPLY_TO
    }

    const total = items.reduce((sum, i) => sum + i.balance, 0);
    const listHtml = items
      .map((i) => {
        const when = i.startsAt
          ? new Date(i.startsAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })
          : "";
        return `<li><strong>${i.clientName}</strong> — ${i.serviceName}${when ? ` (${when})` : ""}: <strong>${formatMoney(i.balance)}</strong> due${i.clientEmail ? ` · ${i.clientEmail}` : ""}</li>`;
      })
      .join("");

    if (resend) {
      try {
        await resend.emails.send({
          from: MELORI_FROM,
          to: [toEmail],
          replyTo: MELORI_REPLY_TO,
          subject: `${items.length} completed session${items.length > 1 ? "s" : ""} with an unpaid balance (${formatMoney(total)})`,
          html: `<p>These sessions are marked completed but still have an outstanding balance:</p><ul>${listHtml}</ul><p>Open <a href="https://melorimusic.org/studio/booking">Studio &rarr; Bookings</a> and hit <strong>Charge balance</strong> to email each client a secure pay link.</p>`,
        });
        emailsSent += 1;
      } catch (err) {
        console.warn("photo-balance-reminders email failed", err);
        // Do NOT stamp as reminded if the email failed — retry next run.
        continue;
      }
    }

    // Stamp these bookings so we don't remind again tomorrow.
    const ids = items.map((i) => i.id);
    await supabase
      .from("photo_bookings")
      .update({ balance_reminder_sent_at: new Date().toISOString() })
      .in("id", ids);
  }

  // -------------------------------------------------------------------------
  // Client-facing reminders: email the CLIENT directly, every 3 days, with a
  // one-click Stripe pay link, until the balance is paid or booking cancelled.
  // Independent of the owner digest above (own timestamp column), so the owner
  // "remind once" behaviour is unaffected.
  // -------------------------------------------------------------------------
  const clientResult = await remindClients(supabase, resend);

  return NextResponse.json({
    ok: true,
    reminders: owed.length,
    emailsSent,
    clientReminders: clientResult.sent,
  });
}

type SupabaseAdmin = ReturnType<typeof getSupabaseAdmin>;
type ResendClient = ReturnType<typeof getResend>;

async function remindClients(
  supabase: SupabaseAdmin,
  resend: ResendClient,
): Promise<{ sent: number }> {
  const cutoffIso = new Date(Date.now() - CLIENT_REMINDER_INTERVAL_MS).toISOString();

  // Completed, unpaid bookings with a client email, that either have never
  // been reminded or were last reminded > 3 days ago.
  const { data: rows, error } = await supabase
    .from("photo_bookings")
    .select(
      "id, photographer_id, client_name, client_email, starts_at, deposit_cents, balance_cents, balance_paid, status, client_balance_reminder_sent_at, photo_services(name, price_cents)",
    )
    .eq("status", "completed")
    .eq("balance_paid", false)
    .not("client_email", "is", null)
    .or(`client_balance_reminder_sent_at.is.null,client_balance_reminder_sent_at.lt.${cutoffIso}`)
    .order("starts_at", { ascending: true });

  if (error) {
    console.error("photo-balance-reminders client query failed", error.message);
    return { sent: 0 };
  }

  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  const stripe = stripeSecret ? new Stripe(stripeSecret) : null;
  let sent = 0;

  for (const r of (rows ?? []) as ClientRow[]) {
    const email = (r.client_email ?? "").trim();
    if (!email) continue;
    const svc = Array.isArray(r.photo_services) ? r.photo_services[0] : r.photo_services;
    const price = Number.isInteger(svc?.price_cents) ? (svc?.price_cents as number) : 0;
    const deposit = Number.isInteger(r.deposit_cents) ? (r.deposit_cents as number) : 0;
    const balance = (r.balance_cents ?? 0) > 0 ? (r.balance_cents as number) : Math.max(price - deposit, 0);
    if (balance <= 0) continue;

    const serviceName = svc?.name ?? "Photography session";
    const clientName = r.client_name ?? "there";

    // Fresh Stripe checkout for the balance (webhook handles photo_balance).
    let payUrl = `${SITE_ORIGIN}/pricing`;
    if (stripe) {
      try {
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          payment_method_types: ["card"],
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: "usd",
                unit_amount: balance,
                product_data: { name: `Balance \u2014 ${serviceName}` },
              },
            },
          ],
          customer_email: email,
          success_url: `${SITE_ORIGIN}/book/success?bookingId=${r.id}&balance=1&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${SITE_ORIGIN}/pricing`,
          metadata: {
            type: "photo_balance",
            bookingId: String(r.id),
            photographer_id: String(r.photographer_id),
          },
        });
        if (session.url) {
          payUrl = session.url;
          await supabase
            .from("photo_bookings")
            .update({ balance_cents: balance, balance_session_id: session.id })
            .eq("id", r.id);
        }
      } catch (err) {
        console.warn("client reminder stripe session failed", err);
        // Skip this booking this run rather than sending a broken link.
        continue;
      }
    } else {
      // No Stripe configured — don't send a payment email with no link.
      continue;
    }

    if (!resend) continue;
    try {
      await resend.emails.send({
        from: MELORI_FROM,
        to: [email],
        replyTo: MELORI_REPLY_TO,
        subject: `Balance due for your ${serviceName} \u2014 ${formatMoney(balance)}`,
        html: `<p>Hi ${clientName},</p><p>This is a friendly reminder that the remaining balance for your <strong>${serviceName}</strong> with Karl Ray Photography is <strong>${formatMoney(balance)}</strong>.</p><p>You can pay securely in one click here:</p><p><a href="${payUrl}">Pay your balance (${formatMoney(balance)})</a></p><p>If you&apos;ve already arranged payment, please disregard this note. Reply to this email with any questions.</p><p>Thank you!<br/>\u2014 Karl Ray Photography</p>`,
      });
      await supabase
        .from("photo_bookings")
        .update({ client_balance_reminder_sent_at: new Date().toISOString() })
        .eq("id", r.id);
      sent += 1;
    } catch (err) {
      console.warn("client reminder email failed", err);
      // Don't stamp — retry next run.
    }
  }

  return { sent };
}

type ClientRow = {
  id: string;
  photographer_id: string;
  client_name: string | null;
  client_email: string | null;
  starts_at: string | null;
  deposit_cents: number | null;
  balance_cents: number | null;
  status: string;
  client_balance_reminder_sent_at: string | null;
  photo_services: { name?: string; price_cents?: number } | { name?: string; price_cents?: number }[] | null;
};

export const GET = handle;
export const POST = handle;
