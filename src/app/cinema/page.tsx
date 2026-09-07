import type { Metadata } from "next";
import FeatureTeaser from "@/components/marketing/FeatureTeaser";

export const metadata: Metadata = {
  title: "MM Cinema — watch together on Melori",
  description:
    "MM Cinema is a screening room. Premieres and music videos played for a room of people at the same time, with everyone reacting together. Free to join.",
  openGraph: {
    title: "MM Cinema — watch together on Melori",
    description:
      "A screening room for premieres and music videos, watched together in real time. Free to join.",
    images: ["/images/og-image.png"],
  },
};

export default function CinemaTeaserPage() {
  return (
    <FeatureTeaser
      self="/cinema"
      eyebrow="MM Cinema"
      title="Watch it together, not alone"
      lede="Cinema is a screening room. A video plays for everyone at the same moment — a premiere, a new visual, something an artist has never shown anyone — and the room reacts to it as it happens."
      points={[
        {
          title: "One screen, everyone on it",
          body: "Playback is shared. Nobody is thirty seconds ahead of the person next to them.",
        },
        {
          title: "The room talks back",
          body: "Reactions and comments run alongside the video, so a premiere feels like a premiere.",
        },
        {
          title: "The artist is in the room",
          body: "Cinema nights are usually hosted by whoever made the thing you are watching.",
        },
      ]}
      howItWorks={[
        "Create a free account — an email, a mobile number and a password.",
        "Open Cinema to see what is screening now and what is starting soon.",
        "Take a seat; the video starts for everyone together.",
        "Host your own screening when you have something to premiere.",
      ]}
    />
  );
}
