// Shared rules for photos in Messages (migration 092).
//
// Files live in the PRIVATE `message-media` bucket at
//   <conversationId>/<senderId>/<uuid>.<ext>
// The server issues the upload URL (membership checked, path pinned to the
// caller's own folder) and re-checks the path when the message is sent, so a
// client can never attach somebody else's file or a file from another chat.

export const MESSAGE_MEDIA_BUCKET = "message-media";
export const MAX_ATTACHMENTS = 4;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export const IMAGE_TYPES: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export type MessageAttachment = {
  type: "image";
  path: string;
  width?: number;
  height?: number;
};

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const PATH_RE = new RegExp(`^(${UUID})/(${UUID})/(${UUID})\\.(jpg|png|webp|gif)$`);

/** Validate attachments sent with a message. Returns the cleaned list, or an
 *  error string. Every path must sit in THIS conversation and the SENDER's
 *  folder. */
export function validateAttachments(
  raw: unknown,
  conversationId: string,
  senderId: string,
): MessageAttachment[] | string {
  if (raw == null) return [];
  if (!Array.isArray(raw)) return "attachments must be a list";
  if (raw.length > MAX_ATTACHMENTS) return `At most ${MAX_ATTACHMENTS} photos per message`;
  const out: MessageAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") return "Invalid attachment";
    const { type, path, width, height } = a as Record<string, unknown>;
    if (type !== "image" || typeof path !== "string") return "Invalid attachment";
    const m = PATH_RE.exec(path);
    if (!m) return "Invalid attachment path";
    if (m[1].toLowerCase() !== conversationId.toLowerCase() || m[2].toLowerCase() !== senderId.toLowerCase()) {
      return "Attachment does not belong to this conversation";
    }
    const dim = (v: unknown) =>
      typeof v === "number" && Number.isFinite(v) && v > 0 && v < 20000 ? Math.round(v) : undefined;
    out.push({ type: "image", path, width: dim(width), height: dim(height) });
  }
  return out;
}

/** Text used where a photo-only message needs words (inbox, email). */
export function previewText(content: string | null | undefined): string {
  const t = (content ?? "").trim();
  return t || "📷 Photo";
}

// The reactions offered in the UI. Also the server's allow-list, so the
// column only ever holds these (no arbitrary text smuggled in as an "emoji").
// The first one is the double-tap "like".
export const REACTION_EMOJI = ["❤️", "😂", "🔥", "👏", "😮", "😢"] as const;
