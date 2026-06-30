import Link from "next/link";
import type { Metadata } from "next";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Membership",
  description:
    "Support independent music. Get closer to the artists you love. Or become one yourself.",
  openGraph: {
    title: "Membership",
    description:
      "Support independent music. Get closer to the artists you love.",
    images: ["/images/og-image.png"],
  },
};

interface Tier {
  id: number;
  slug: string;
  name: string;
  tagline: string | null;
  description: string | null;
  price_monthly: number;
  price_yearly: number;
  features: string[];
  color: string;
  is_popular: boolean;
  display_order: number;
}

async function getTiers(): Promise<Tier[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("membership_tiers")
      .select(
        "id, slug, name, tagline, description, price_monthly, price_yearly, features, color, is_popular, display_order"
      )
      .eq("is_active", true)
      .order("display_order", { ascending: true });
    if (error) {
      console.error("getTiers error", error);
      return [];
    }
    return (data as Tier[]) ?? [];
  } catch (err) {
    console.error("getTiers exception", err);
    return [];
  }
}

function formatPrice(n: number): string {
  if (n === 0) return "Free";
  return `$${Number(n).toFixed(2)}`;
}

export default async function MembershipPage() {
  const tiers = await getTiers();

  return (
    <div className="bg-brand-background text-text-primary">
      <section className="relative overflow-hidden">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="max-w-4xl mx-auto px-6 py-20 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">
            Choose your membership
          </h1>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            Support independent music. Get closer to the artists you love. Or
            become one yourself.
          </p>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-16">
        {tiers.length === 0 ? (
          <p className="text-center text-text-secondary">
            Memberships will be available soon.
          </p>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {tiers.map((tier) => {
              const monthly = Number(tier.price_monthly);
              const yearly = Number(tier.price_yearly);
              const yearlySavings =
                monthly > 0 && yearly > 0
                  ? Math.round((1 - yearly / (monthly * 12)) * 100)
                  : 0;
              const isFree = monthly === 0;

              return (
                <article
                  key={tier.id}
                  className={`relative flex flex-col p-8 rounded-2xl border bg-white/5 ${
                    tier.is_popular
                      ? "border-brand-primary shadow-lg md:scale-105"
                      : "border-brand-border"
                  }`}
                >
                  {tier.is_popular && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-brand-primary text-white text-xs font-semibold uppercase tracking-wide">
                      Most Popular
                    </div>
                  )}

                  <h3 className="text-2xl font-bold">{tier.name}</h3>
                  {tier.tagline && (
                    <p className="mt-1 text-sm text-text-secondary">
                      {tier.tagline}
                    </p>
                  )}

                  <div className="mt-6">
                    <div className="flex items-baseline gap-1">
                      <span className="text-4xl font-bold">
                        {formatPrice(monthly)}
                      </span>
                      {monthly > 0 && (
                        <span className="text-text-secondary">/month</span>
                      )}
                    </div>
                    {yearly > 0 && (
                      <p className="mt-1 text-sm text-text-secondary">
                        or ${yearly.toFixed(2)}/year
                        {yearlySavings > 0 && (
                          <span className="ml-2 text-brand-primary font-medium">
                            save {yearlySavings}%
                          </span>
                        )}
                      </p>
                    )}
                  </div>

                  {tier.description && (
                    <p className="mt-4 text-sm text-text-secondary leading-relaxed">
                      {tier.description}
                    </p>
                  )}

                  <ul className="mt-6 space-y-2 flex-1">
                    {(tier.features ?? []).map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm">
                        <span aria-hidden className="text-brand-primary mt-0.5">
                          ✓
                        </span>
                        <span className="text-text-secondary">{f}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-8">
                    {isFree ? (
                      <Link
                        href="/music"
                        className="block w-full text-center px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
                      >
                        Start Listening
                      </Link>
                    ) : (
                      <button
                        type="button"
                        disabled
                        className="block w-full text-center px-6 py-3 rounded-full font-semibold border border-brand-border text-text-secondary cursor-not-allowed"
                      >
                        Coming Soon
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <p className="mt-12 text-center text-sm text-text-secondary">
          Cancel anytime. No hidden fees. 70% of every paid membership goes
          directly to artists.
        </p>
      </section>
    </div>
  );
}
