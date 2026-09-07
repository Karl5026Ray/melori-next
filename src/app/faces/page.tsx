import type { Metadata } from "next";
import FeatureTeaser from "@/components/marketing/FeatureTeaser";

export const metadata: Metadata = {
  title: "MM Faces — live video rooms on Melori",
  description:
    "MM Faces is live video on Melori. Artists and listeners in the same room, on camera, in real time. Free to join.",
  openGraph: {
    title: "MM Faces — live video rooms on Melori",
    description:
      "Live video rooms where artists and listeners share the same screen. Free to join.",
    images: ["/images/og-image.png"],
  },
};

export default function FacesTeaserPage() {
  return (
    <FeatureTeaser
      self="/faces"
      eyebrow="MM Faces"
      title="Go face to face, live"
      lede="Faces is live video on Melori. An artist opens a room, people come in, and everyone is on camera together — no stage, no distance, no waiting for a comment reply three days later."
      points={[
        {
          title: "Real time, real faces",
          body: "You are in the room, not watching a broadcast. Anyone in a Faces room can be seen and heard by the rest of it.",
        },
        {
          title: "Small on purpose",
          body: "These are rooms, not stadiums. The point is that the artist can actually see who turned up and say your name.",
        },
        {
          title: "Moderated",
          body: "Hosts control who is on camera and can remove anyone. Some rooms are women only, and those stay that way.",
        },
      ]}
      howItWorks={[
        "Create a free account — an email, a mobile number and a password.",
        "Open Faces and you will see the rooms that are live right now.",
        "Join one, or start your own and invite people into it.",
        "Camera and microphone stay off until you turn them on.",
      ]}
    />
  );
}
