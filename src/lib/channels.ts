// Karl's YouTube channels (2026-10-22). One list for /links and the Shows
// section on /karlray, so adding a channel is a one-line change.
//
// Why a page at all: Facebook shows every profile link as a bare
// "youtube.com", so eight channel links under Karl's name told a visitor
// nothing. One public page with each show by name fixes that, and
// melori.org/links 308s here (see routePlatformHost in src/proxy.ts).

export interface Channel {
  name: string;
  blurb: string;
  handle: string;
  /** Thumbnail under /public/images/channels. */
  image: string;
  group: "Main" | "Series" | "For kids" | "My work";
}

export const CHANNELS: Channel[] = [
  { group: "Main", name: "Karl Ray Production", blurb: "My main channel", handle: "karlrayproduction", image: "karl" },
  { group: "Series", name: "Say It Out Loud", blurb: "Five couples, real conversations", handle: "SayItOutLoudSeries", image: "siol" },
  { group: "Series", name: "WOE", blurb: "A drama series of love and deceit", handle: "woeseries2026", image: "woe" },
  { group: "Series", name: "Without The Blacks", blurb: "REFLECT: the inventors history left out", handle: "WithoutTheBlacks", image: "wtb" },
  { group: "Series", name: "Taste & Grace", blurb: "One dish at a time", handle: "TasteAndGraceKitchen", image: "tg" },
  { group: "For kids", name: "The Melori Band", blurb: "Music lessons with Pip and the band", handle: "TheMeloriBand", image: "mb" },
  { group: "For kids", name: "The Hikari Files", blurb: "Every mystery gets a file", handle: "Hikari-Mystery-Files", image: "hk" },
  { group: "My work", name: "vidsbyKarl", blurb: "Photo and video work, stage to screen", handle: "vidsbyBINO5026", image: "vids" },
];

export const channelUrl = (c: Channel) => `https://www.youtube.com/@${c.handle}`;
export const channelImage = (c: Channel) => `/images/channels/${c.image}.jpg`;

export const LINKS_PATH = "/links";
