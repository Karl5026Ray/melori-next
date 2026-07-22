import type { Metadata } from "next";
import ProfileScroller from "@/components/social/profile/ProfileScroller";

// Runtime-only (queries Supabase per request); no static prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discover Members · Melori",
  description:
    "Swipe through Melori members — artists, superfans, and friends. Follow, message, or open a profile in one tap.",
};

// Full-viewport, TikTok-style profile scroller. Wrapped in a flex column so
// the social layout's header/nav stays visible while the scroller itself
// owns the remaining vertical space.
export default function DiscoverPage() {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <ProfileScroller />
    </div>
  );
}
