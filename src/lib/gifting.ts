import type { SpaceParticipant } from "@/types/social";

export const COIN_PACK_SOURCE = "melorimusic.org/coin-pack";

export type GiftMediaKind = "video" | "image" | "model";

export interface GiftCatalogItem {
  id: string;
  slug: string;
  name: string;
  tier: "spark" | "glow" | "epic";
  asset_url: string;
  duration_ms: number;
  price_coins: number;
}

export interface GiftSignal {
  type: "gift";
  giftSendId: string;
  gift: GiftCatalogItem;
  targetId: string;
  senderName?: string;
}

export function giftMediaKind(assetUrl: string): GiftMediaKind {
  const pathname = assetUrl.split("?")[0].toLowerCase();
  if (/\.glb$/.test(pathname)) return "model";
  return /\.(mp4|webm|mov|m4v)$/.test(pathname) ? "video" : "image";
}

export function isConcertRoom(roomFormat: string | null | undefined): boolean {
  return roomFormat === "versus_battle";
}

export function isEligibleGiftTarget(
  participant: Pick<SpaceParticipant, "user_id" | "role">,
  hostId: string,
): boolean {
  return (
    participant.user_id === hostId ||
    participant.role === "host" ||
    participant.role === "speaker"
  );
}

export function canSendGiftInRoom(args: {
  roomFormat: string | null | undefined;
  roomStatus: string | null | undefined;
  sender: Pick<SpaceParticipant, "user_id" | "role"> | null | undefined;
  target: Pick<SpaceParticipant, "user_id" | "role"> | null | undefined;
  hostId: string;
}): boolean {
  return Boolean(
    isConcertRoom(args.roomFormat) &&
      args.roomStatus === "live" &&
      args.sender &&
      isEligibleGiftTarget(args.target ?? { user_id: "", role: "audience" }, args.hostId),
  );
}

export function isCoinPackCheckoutMetadata(
  metadata: Record<string, string | undefined | null> | null | undefined,
): boolean {
  return metadata?.source === COIN_PACK_SOURCE && Boolean(metadata.pack_id) && Boolean(metadata.user_id);
}

// Stripe's session id is immutable per checkout. Keeping the format here makes
// the webhook's ledger idempotency contract easy to test without a database.
export function coinPackCreditReference(stripeSessionId: string): string {
  return `stripe:${stripeSessionId}`;
}
