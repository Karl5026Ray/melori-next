import type { Metadata } from "next";
import ProfileScroller from "@/components/social/profile/ProfileScroller";

// Runtime-only (queries Supabase per request); no static prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Discover Members · Melori",
  description:
    "Swipe through Melori members — artists, superfans, and friends. Follow, message, or open a profile in one tap.",
};

// Full-viewport, TikTok-style profile scroller. Given a DEFINITE height (the
// dynamic viewport minus the 4rem header) rather than a flex-grow of a
// min-height-only ancestor chain: the scroller and its slides size off
// `h-full`, and without a resolved parent height they fell back to the
// `min-h-[70vh]` basis. On mobile `vh` is the URL-bar-EXPANDED height, so each
// slide was taller than the visible screen — the swipe landed mid-slide and the
// content looked mis-oriented. `dvh` tracks the real visible area, matching the
// working Mirror feed's `.mirror-viewport` pattern, so each slide is exactly
// one screen tall.
export default function DiscoverPage() {
  return (
    <div className="flex flex-col" style={{ height: "calc(100dvh - 4rem)" }}>
      <ProfileScroller />
    </div>
  );
}
