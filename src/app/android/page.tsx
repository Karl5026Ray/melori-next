import type { Metadata } from "next";
import AndroidBetaForm from "@/components/android/AndroidBetaForm";

// Public (see PUBLIC_EXACT in src/proxy.ts): most testers have no Melori
// account yet. Static on purpose — the iPhone note, the signed-in prefill and
// ?src= are all read on the client, so nothing here makes the route dynamic
// (and therefore no-store, which WKWebView treats as a failed load).

export const metadata: Metadata = {
  title: "Get Melori on Android first",
  description:
    "Join the Melori Android beta. Leave the Gmail your Play Store uses and we'll email your install link.",
  alternates: { canonical: "/android" },
};

export default function AndroidBetaPage() {
  return (
    <div className="bg-brand-background text-text-primary">
      <div className="max-w-md mx-auto px-4 pt-10 pb-16">
        <p className="text-xs font-semibold uppercase tracking-widest text-brand-primary mb-3">
          Android beta
        </p>
        <h1 className="text-3xl font-bold leading-tight mb-3">Get Melori on Android first</h1>
        <p className="text-text-secondary mb-6">
          Try the Melori app before it&apos;s in the Play Store for everyone, and help us
          shape it.
        </p>

        <div className="grid gap-3 mb-8">
          <div className="rounded-xl border border-brand-border bg-brand-surface p-4">
            <h2 className="font-semibold mb-1">What you get</h2>
            <p className="text-sm text-text-secondary">
              Early access to the Melori Android app, installed straight from Google Play,
              plus updates before anyone else.
            </p>
          </div>
          <div className="rounded-xl border border-brand-border bg-brand-surface p-4">
            <h2 className="font-semibold mb-1">What we ask</h2>
            <p className="text-sm text-text-secondary">
              Keep it installed for 14 days and open it a few times a week.
            </p>
          </div>
        </div>

        <AndroidBetaForm />
      </div>
    </div>
  );
}
