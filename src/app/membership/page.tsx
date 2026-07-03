import type { Metadata } from "next";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import TierGrid, { type Tier } from "./TierGrid";
import ContactSignupForm from "@/components/ContactSignupForm";

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

async function getTiers(): Promise<Tier[]> {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("membership_tiers")
      .select(
        "id, slug, name, tagline, description, price_monthly, price_yearly, features, color, is_popular, display_order, stripe_payment_link_monthly, stripe_payment_link_yearly"
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
          <TierGrid tiers={tiers} />
        )}

        <p className="mt-12 text-center text-sm text-text-secondary">
          Cancel anytime. No hidden fees. 70% of every paid membership goes
          directly to artists.
        </p>
      </section>

      <section className="max-w-2xl mx-auto px-6 pb-24">
        <div className="mb-6 text-center">
          <h2 className="text-3xl font-bold">Not ready to subscribe?</h2>
          <p className="mt-2 text-text-secondary">
            Join for free — leave your info and we&apos;ll keep you posted on new
            music, updates, and specials.
          </p>
        </div>
        <ContactSignupForm />
      </section>
    </div>
  );
}
