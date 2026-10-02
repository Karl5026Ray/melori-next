import type { Metadata } from "next";
import FeatureTeaser from "@/components/marketing/FeatureTeaser";

// The public face of /music.
//
// The tab bar's "Explore" tab is /music, which is members-only. A signed-out
// visitor who tapped it used to be bounced to the bare signup form with no idea
// why (outside review, 2 Oct 2026). The proxy now sends them here instead, the
// same way /social/spaces sends them to /spaces.
//
// The catalog itself stays a members' perk: nothing on this page lists tracks,
// plays audio or reads member data. It is written copy, like every other
// FeatureTeaser page.

export const metadata: Metadata = {
  title: "Melori Music — independent music, free to members",
  description:
    "R&B, soul, gospel and hip-hop from independent artists. Free with a Melori account.",
  openGraph: {
    title: "Melori Music — independent music, free to members",
    description:
      "Independent music from the artists on Melori. Free with an account.",
    images: ["/images/og-image.png"],
  },
};

export default function ListenTeaserPage() {
  return (
    <FeatureTeaser
      self="/listen"
      eyebrow="Melori Music"
      title="All the music, free to members"
      lede="Melori's catalog is independent music you won't hear everywhere else — R&B, soul, gospel and hip-hop from artists like Karl Ray, Kaiel R and Gloria Joy Rivers, and new releases from the creators on the platform. Make a free account and the whole catalog opens."
      points={[
        {
          title: "Free with an account",
          body: "There is no paid tier for listening. Every member gets the whole catalog.",
        },
        {
          title: "Straight from the artists",
          body: "Independent artists put their own releases here, and each one has a page you can visit.",
        },
        {
          title: "Radio when you don't want to choose",
          body: "Let Melori Radio pick the next song while you do something else.",
        },
      ]}
      howItWorks={[
        "Create a free account with an email and a password.",
        "Open Music to browse albums and singles.",
        "Press play, and save the songs you love to your favorites.",
        "Switch to Radio when you want something picked for you.",
      ]}
      closing={{
        title: "The catalog is for members only.",
        body: "The music opens when you sign in. Membership is free, and so is every song in it.",
      }}
    />
  );
}
