// src/lib/toolkit.ts
//
// The Artist Toolkit: third-party tools Karl recommends to Melori artists.
// Some links are affiliate links (Karl may earn a commission). Melori itself
// still sells nothing — these are outbound recommendations, disclosed as such.
//
// Rules this list must keep (pinned by scripts/toolkit.test.ts):
//   • every enabled entry has an absolute https URL;
//   • every affiliate entry is rendered with rel="sponsored" and the
//     disclosure is shown on the page (FTC);
//   • an entry whose program has not approved Karl stays enabled:false, so a
//     dead or untracked link never ships.

export type ToolkitItem = {
  id: string;
  name: string;
  category: string;
  blurb: string;
  url: string;
  affiliate: boolean;
  enabled: boolean;
};

export const TOOLKIT_DISCLOSURE =
  "Some links on this page are affiliate links. If you sign up through them, Melori's founder may earn a commission at no extra cost to you. We only list tools we'd use ourselves.";

export const TOOLKIT_ITEMS: ToolkitItem[] = [
  {
    id: "splice",
    name: "Splice",
    category: "Samples & loops",
    blurb:
      "Millions of royalty-free sounds from top artists and sound designers. Clear your samples once and use them in released tracks.",
    url: "https://splice.sjv.io/rEoRvd",
    affiliate: true,
    enabled: true,
  },
  {
    id: "eastwest",
    name: "EastWest Sounds",
    category: "Virtual instruments",
    blurb:
      "Orchestral, choir, piano and world instruments used in film, TV and games. A deep library for producers who want real-sounding parts.",
    url: "https://eastwestsounds.sjv.io/enPao6",
    affiliate: true,
    enabled: true,
  },
  {
    // Application under review on impact.com. Flip to enabled with the
    // tracking link once DistroKid approves — never ship the bare homepage
    // as if it were tracked.
    id: "distrokid",
    name: "DistroKid",
    category: "Distribution",
    blurb:
      "Get your music onto Spotify, Apple Music, TikTok and more, and keep 100% of your earnings.",
    url: "",
    affiliate: true,
    enabled: false,
  },
];

export function visibleToolkitItems(items: ToolkitItem[] = TOOLKIT_ITEMS): ToolkitItem[] {
  return items.filter((i) => i.enabled && /^https:\/\//.test(i.url));
}

export function toolkitRel(item: ToolkitItem): string {
  return item.affiliate ? "sponsored noopener noreferrer" : "noopener noreferrer";
}
