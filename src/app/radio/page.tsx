import type { Metadata } from "next";
import FeatureTeaser from "@/components/marketing/FeatureTeaser";

export const metadata: Metadata = {
  title: "Radio — the non-stop Melori mix",
  description:
    "Melori Radio plays the catalog end to end — independent artists, no ads, nothing to buy. Free to every member.",
  openGraph: {
    title: "Radio — the non-stop Melori mix",
    description:
      "A continuous mix of the Melori catalog. Independent artists, no ads. Free to every member.",
    images: ["/images/og-image.png"],
  },
};

export default function RadioTeaserPage() {
  return (
    <FeatureTeaser
      self="/radio"
      eyebrow="Radio"
      title="Press play and leave it on"
      lede="Radio is the Melori catalog running end to end. Independent artists, one after another, with nothing to buy and nothing interrupting it."
      points={[
        {
          title: "Free to every member",
          body: "There is no paid tier for listening. An account is the whole price.",
        },
        {
          title: "No ads",
          body: "Nothing is read out between records and nothing is sold to you mid-song.",
        },
        {
          title: "Independent only",
          body: "Everything in the mix was uploaded by the artist who made it.",
        },
      ]}
      howItWorks={[
        "Create a free account — an email, a mobile number and a password.",
        "Open Radio and it starts playing.",
        "Keep listening while you move around the rest of Melori.",
        "Follow anything you like straight from the player.",
      ]}
    />
  );
}
