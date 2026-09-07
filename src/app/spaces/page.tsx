import type { Metadata } from "next";
import FeatureTeaser from "@/components/marketing/FeatureTeaser";

export const metadata: Metadata = {
  title: "MM Spaces — live audio rooms on Melori",
  description:
    "MM Spaces is live audio on Melori. Listening sessions, writing rooms and conversations you can drop into. Free to join.",
  openGraph: {
    title: "MM Spaces — live audio rooms on Melori",
    description:
      "Live audio rooms for listening sessions, writing rooms and conversations. Free to join.",
    images: ["/images/og-image.png"],
  },
};

export default function SpacesTeaserPage() {
  return (
    <FeatureTeaser
      self="/spaces"
      eyebrow="MM Spaces"
      title="Rooms you can talk in"
      lede="Spaces is live audio. Someone opens a room — a listening session, a writing room, a conversation about a record nobody else has heard yet — and you drop in and hear it happen."
      points={[
        {
          title: "Audio only",
          body: "No camera. Spaces is for the times you want to be in the room without being on screen.",
        },
        {
          title: "Ask for the mic",
          body: "You arrive listening. Raise a hand and the host can bring you up to speak.",
        },
        {
          title: "Scheduled or right now",
          body: "Rooms can go live on the spot or be put on the calendar so people can turn up for them.",
        },
      ]}
      howItWorks={[
        "Create a free account — an email, a mobile number and a password.",
        "Open Spaces to see what is live and what is scheduled.",
        "Join as a listener; your microphone is off until the host brings you up.",
        "Start your own room whenever you have something to play or say.",
      ]}
    />
  );
}
