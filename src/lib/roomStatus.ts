import { auditionRoomHref, isAuditionFormat } from "@/lib/auditions";
export type LivePresenceKind =
  | "faces_live"
  | "spaces_live"
  | "cinema_live";

export type LivePresenceTone = "orange" | "teal" | "purple" | "gold";

export type LiveRoomPresentation = {
  kind: LivePresenceKind;
  label: "Live" | "Space" | "Cinema";
  ariaLabel: string;
  icon: "video" | "mic" | "radio" | "clapperboard";
  tone: LivePresenceTone;
  href: string;
};

const FACES_FORMATS = new Set(["live_solo", "live_duo", "live_group"]);

/**
 * One product-level contract for the location rings shown in Melori Mirror.
 * Lifecycle state and visual location are deliberately separate: only a live
 * room receives a live presentation, while recently active members use the
 * neutral ONLINE presentation below.
 */
export function getLiveRoomPresentation(room: {
  id: string;
  status?: string | null;
  room_format?: string | null;
}): LiveRoomPresentation | null {
  if (!room.id || (room.status != null && room.status !== "live")) return null;

  if (FACES_FORMATS.has(room.room_format ?? "")) {
    return {
      kind: "faces_live",
      label: "Live",
      ariaLabel: "Live video on MM Faces",
      icon: "video",
      tone: "orange",
      href: `/social/live/${room.id}`,
    };
  }


  // Normally filtered out before it gets here (/api/mirror/live excludes
  // audition rooms), but if one ever arrives it must link to Auditions, not
  // fall through to the Spaces default.
  if (isAuditionFormat(room.room_format)) {
    return {
      kind: "spaces_live",
      label: "Space",
      ariaLabel: "Audition room",
      icon: "video",
      tone: "purple",
      href: auditionRoomHref(room.id),
    };
  }

  if (room.room_format === "cinema") {
    return {
      kind: "cinema_live",
      label: "Cinema",
      ariaLabel: "Cinema watch party live",
      icon: "clapperboard",
      tone: "gold",
      href: `/social/cinema/${room.id}`,
    };
  }

  return {
    kind: "spaces_live",
    label: "Space",
    ariaLabel: "Live audio Space",
    icon: "radio",
    tone: "purple",
    href: `/social/spaces/${room.id}`,
  };
}

export const ONLINE_PRESENCE_PRESENTATION = {
  kind: "online",
  label: "Online",
  ariaLabel: "Online, not in a room",
  icon: "user",
  tone: "neutral-green",
} as const;
