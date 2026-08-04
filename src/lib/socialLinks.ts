// Real social destinations for Melori.
//
// These used to be bare platform home pages ("https://facebook.com"), which
// made a live site look like an unfinished demo: the link said "MELORI Music on
// Facebook" and dropped the visitor on Facebook's front door. Rule now: a
// social icon renders ONLY when a real profile URL exists. No profile, no icon.
//
// Values can be overridden per-environment with NEXT_PUBLIC_SOCIAL_* env vars
// so a new handle can go live without a code change.

export type SocialPlatform =
  | "facebook"
  | "instagram"
  | "tiktok"
  | "youtube"
  | "x";

/** Verified profiles. Leave a value empty ("") until the profile actually exists. */
const PROFILES: Record<SocialPlatform, string> = {
  // Verified 2026-08: 17.5K subscribers, 199 videos, links back to melorimusic.org.
  youtube: "https://www.youtube.com/@karlrayproduction",
  // Verified 2026-08: listed as the official TikTok on the YouTube channel profile.
  tiktok: "https://www.tiktok.com/@karlrayphotography",
  facebook: "",
  instagram: "",
  x: "",
};

const ENV_OVERRIDES: Record<SocialPlatform, string | undefined> = {
  facebook: process.env.NEXT_PUBLIC_SOCIAL_FACEBOOK,
  instagram: process.env.NEXT_PUBLIC_SOCIAL_INSTAGRAM,
  tiktok: process.env.NEXT_PUBLIC_SOCIAL_TIKTOK,
  youtube: process.env.NEXT_PUBLIC_SOCIAL_YOUTUBE,
  x: process.env.NEXT_PUBLIC_SOCIAL_X,
};

const LABELS: Record<SocialPlatform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
};

export interface ResolvedSocialLink {
  platform: SocialPlatform;
  label: string;
  href: string;
  /** Human-readable handle, derived from the URL, for the accessible label. */
  handle: string;
}

function handleFromHref(href: string): string {
  try {
    const url = new URL(href);
    const path = url.pathname.replace(/\/+$/, "");
    if (!path || path === "") return url.hostname.replace(/^www\./, "");
    const last = path.split("/").filter(Boolean).pop() ?? "";
    return last.startsWith("@") ? last : `@${last}`;
  } catch {
    return "";
  }
}

/** A profile URL only counts if it points somewhere past the platform's front door. */
function isRealProfile(href: string | undefined): href is string {
  if (!href) return false;
  const trimmed = href.trim();
  if (!/^https:\/\//i.test(trimmed)) return false;
  try {
    const url = new URL(trimmed);
    const path = url.pathname.replace(/\/+$/, "");
    return path.length > 0;
  } catch {
    return false;
  }
}

/** Configured, real social profiles — in display order. Empty when none exist. */
export function getSocialLinks(): ResolvedSocialLink[] {
  const order: SocialPlatform[] = [
    "youtube",
    "tiktok",
    "instagram",
    "facebook",
    "x",
  ];
  return order.flatMap((platform) => {
    const href = ENV_OVERRIDES[platform]?.trim() || PROFILES[platform];
    if (!isRealProfile(href)) return [];
    return [
      {
        platform,
        label: LABELS[platform],
        href,
        handle: handleFromHref(href),
      },
    ];
  });
}
