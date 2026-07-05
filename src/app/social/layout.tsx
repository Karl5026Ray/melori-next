import type { Metadata } from "next";
import { SocialAuthProvider } from "@/components/social/providers/AuthProvider";
import { SocialShell } from "@/components/social/layout/SocialShell";

export const metadata: Metadata = {
  title: "MM Social",
  description:
    "Audio rooms, direct messaging, and video for independent artists and superfans on Melori Music.",
};

export default function SocialLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SocialAuthProvider>
      <SocialShell>{children}</SocialShell>
    </SocialAuthProvider>
  );
}
