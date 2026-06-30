import Link from "next/link";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Thank You",
  description: "Your donation supports independent music on Melori.",
};

interface VerifyResult {
  ok: boolean;
  amount?: number;
  email?: string | null;
}

async function verifySession(
  sessionId: string,
  origin: string
): Promise<VerifyResult> {
  try {
    const res = await fetch(
      `${origin}/api/donate/verify?session_id=${encodeURIComponent(sessionId)}`,
      { cache: "no-store" }
    );
    if (!res.ok) return { ok: false };
    return (await res.json()) as VerifyResult;
  } catch {
    return { ok: false };
  }
}

export default async function DonateSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const params = await searchParams;
  const sessionId = params?.session_id;

  let result: VerifyResult = { ok: false };
  if (sessionId) {
    const { headers } = await import("next/headers");
    const h = await headers();
    const host = h.get("host") || "melorimusic.org";
    const proto = h.get("x-forwarded-proto") || "https";
    result = await verifySession(sessionId, `${proto}://${host}`);
  }

  return (
    <div className="bg-brand-background text-text-primary">
      <section className="relative overflow-hidden">
        <div className="hero-glow absolute inset-0 -z-10" aria-hidden />
        <div className="max-w-2xl mx-auto px-6 py-24 text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4">Thank you</h1>
          {result.ok && result.amount ? (
            <p className="text-lg text-text-secondary mb-2">
              Your donation of ${result.amount.toFixed(2)} has been received.
            </p>
          ) : (
            <p className="text-lg text-text-secondary mb-2">
              Your donation has been received.
            </p>
          )}
          <p className="text-text-secondary max-w-xl mx-auto mb-8">
            We&apos;re grateful for your support. Every contribution helps us pay
            artists and build a better home for independent music.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href="/music"
              className="px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white"
            >
              Discover Music
            </Link>
            <Link
              href="/"
              className="px-6 py-3 rounded-full font-semibold border border-brand-border hover:border-brand-primary transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
