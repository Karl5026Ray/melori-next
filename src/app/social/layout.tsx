import type { Metadata } from "next";
import { Sidebar } from "@/components/social/layout/Sidebar";
import { SocialAuthProvider } from "@/components/social/providers/AuthProvider";

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
      <div className="flex min-h-[calc(100vh-4rem)] bg-melori-void text-melori-text">
        <Sidebar />
        <div className="flex-1 flex flex-col relative">{children}</div>
      </div>
    </SocialAuthProvider>
  );
}
