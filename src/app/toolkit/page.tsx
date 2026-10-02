import type { Metadata } from "next";
import ToolkitLinks from "@/components/toolkit/ToolkitLinks";

export const metadata: Metadata = {
  title: "Artist Toolkit",
  description:
    "Tools we recommend to independent artists on Melori: samples, virtual instruments and distribution.",
};

// Members-only: /toolkit is not on the signup-wall allowlist (src/proxy.ts),
// so it is a resource for signed-in artists, not a public ad page.
export default function ToolkitPage() {
  return (
    <div className="bg-brand-background text-text-primary">
      <section className="max-w-4xl mx-auto px-6 py-20">
        <h1 className="text-4xl md:text-5xl font-bold mb-4">Artist Toolkit</h1>
        <p className="text-lg text-text-secondary mb-12 max-w-2xl">
          The tools we use to make, finish and release music. Melori stays
          free; these are outside services we recommend.
        </p>
        <ToolkitLinks />
      </section>
    </div>
  );
}
