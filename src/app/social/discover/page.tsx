import type { Metadata } from "next";
import ProfileScroller from "@/components/social/profile/ProfileScroller";

// Runtime-only (queries Supabase per request); no static prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discover Members · Melori",
  description:
    "Swipe through Melori members — artists, superfans, and friends. Follow, message, or open a profile in one tap.",
};

// Facebook / news-feed–style profile feed. Deliberately NOT height-constrained:
// the feed is a normal column of self-sizing cards that scrolls with the
// document, so there is no viewport-height math to get wrong. This replaced the
// full-viewport TikTok snap scroller, which repeatedly mis-oriented on mobile
// because it coupled slide height to a resolved parent `100dvh`/`h-full` chain
// and rendered each banner as a full-screen crop.
export default function DiscoverPage() {
  return <ProfileScroller />;
}
