import type { Metadata } from "next";
import ConnectApp from "@/components/social/connect/ConnectApp";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Melori Connect",
  description:
    "Meet people through your music. Swipe, match, and start a conversation with members who share your taste on Melori.",
};

export default function ConnectPage() {
  return <ConnectApp />;
}
