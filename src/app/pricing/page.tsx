import Link from "next/link";
import type { Metadata } from "next";
import { Camera, Clock, DollarSign } from "lucide-react";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Photography Pricing | Melori Music",
  description:
    "Photography session pricing by Karl Ray Photography — Melori Music. View services, pricing, and book your session.",
};

interface ServiceCard {
  id: string;
  name: string;
  description: string | null;
  durationMinutes: number;
  priceCents: number;
  depositCents: number;
  depositPercent: number | null;
}

async function getActiveServices(): Promise<ServiceCard[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { data: services, error } = await supabase
      .from("photo_services")
      .select(
        "id, name, description, duration_minutes, price_cents, deposit_cents, deposit_percent",
      )
      .eq("is_active", true)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: false });
    if (error || !services) return [];

    return services.map((s) => ({
      id: s.id as string,
      name: s.name as string,
      description: s.description as string | null,
      durationMinutes: s.duration_minutes as number,
      priceCents: s.price_cents as number,
      depositCents: s.deposit_cents as number,
      depositPercent: s.deposit_percent as number | null,
    }));
  } catch (err) {
    console.error("pricing page list error", err);
    return [];
  }
}

function formatPrice(cents: number): string {
  return `$${(cents / 100).toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  const label = Number.isInteger(hours) ? `${hours}` : hours.toFixed(1);
  return `${label} hr${hours === 1 ? "" : "s"}`;
}

export default async function PricingPage() {
  const services = await getActiveServices();

  return (
    <main className="min-h-screen bg-brand-background text-text-primary">
      <section className="mx-auto max-w-5xl px-4 sm:px-6 py-12 sm:py-16">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
            <Camera className="h-6 w-6" />
          </span>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Photography Pricing</h1>
            <p className="text-sm text-text-secondary">
              Sessions by Karl Ray Photography — Melori Music
            </p>
          </div>
        </div>

        <p className="mt-6 max-w-2xl text-text-secondary">
          Browse available sessions below. Pick the service that fits your
          shoot and tap Book to get started — availability and scheduling are
          coming soon.
        </p>

        {services.length === 0 ? (
          <div className="mt-10 rounded-xl border border-brand-border bg-brand-surface p-8 text-center">
            <DollarSign className="mx-auto h-10 w-10 text-brand-primary" />
            <p className="mt-3 font-semibold">No services available yet</p>
            <p className="mt-1 text-sm text-text-secondary">
              Check back soon — pricing is being finalized.
            </p>
          </div>
        ) : (
          <div className="mt-10 grid gap-5 sm:grid-cols-2">
            {services.map((service) => (
              <div
                key={service.id}
                className="flex flex-col rounded-2xl border border-brand-border bg-brand-surface p-6"
              >
                <h2 className="text-xl font-bold text-text-primary">
                  {service.name}
                </h2>
                {service.description && (
                  <p className="mt-2 text-sm text-text-secondary flex-1">
                    {service.description}
                  </p>
                )}
                <div className="mt-4 flex items-center gap-4 text-sm text-text-secondary">
                  <span className="flex items-center gap-1.5">
                    <Clock className="h-4 w-4" />
                    {formatDuration(service.durationMinutes)}
                  </span>
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <span className="text-2xl font-bold bg-gradient-to-r from-brand-primary to-brand-accent bg-clip-text text-transparent">
                    {formatPrice(service.priceCents)}
                  </span>
                  {(service.depositCents > 0 || service.depositPercent) && (
                    <span className="text-xs text-text-secondary">
                      {service.depositPercent
                        ? `${service.depositPercent}% deposit`
                        : `${formatPrice(service.depositCents)} deposit`}{" "}
                      required
                    </span>
                  )}
                </div>
                <Link
                  href={`/book?serviceId=${service.id}`}
                  className="mt-5 flex items-center justify-center rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-3 text-sm font-semibold text-white"
                >
                  Book
                </Link>
              </div>
            ))}
          </div>
        )}

        <p className="mt-12 text-center text-xs text-text-secondary">
          Questions about a session?{" "}
          <a
            href="mailto:karlrayphotography@gmail.com"
            className="text-brand-primary hover:underline"
          >
            Email us
          </a>
          .
        </p>
      </section>
    </main>
  );
}
