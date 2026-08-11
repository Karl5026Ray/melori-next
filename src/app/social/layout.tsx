import type { Metadata } from "next";
import { Sidebar } from "@/components/social/layout/Sidebar";
import { BattleInviteInbox } from "@/components/social/concert/BattleInviteInbox";
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
      {/* dvh, not vh: iOS Safari/WKWebView's collapsing URL bar and the
          safe-area insets make 100vh taller than the real visible viewport,
          which pushes fixed/in-flow bottom bars (e.g. the Spaces control
          bar) out of view. dvh tracks the actual visible area. */}
      <div className="flex min-h-[calc(100dvh-4rem)] bg-melori-void text-melori-text">
        <Sidebar />
        <BattleInviteInbox />
        {/* min-w-0: a flex item's default min-width is `auto`, which means
            it refuses to shrink below its content's intrinsic width. On
            mobile the Sidebar is `hidden`, but this wrapper is still a flex
            item and, without min-w-0, pages with unbreakable-looking inline
            content (e.g. the Spaces header's icon-button row) forced the
            whole page wider than the viewport, causing horizontal
            scrolling/side-to-side shifting on iOS. */}
        <div className="flex-1 flex flex-col relative min-w-0">{children}</div>
      </div>
    </SocialAuthProvider>
  );
}
