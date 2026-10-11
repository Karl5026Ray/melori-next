// MM Auditions — shared, dependency-free rules (server + client).
//
// Auditions is a set of room FORMATS on the existing `spaces` engine, the same
// way Cinema is: a room is a `spaces` row with room_format in
// AUDITION_ROOM_FORMATS. Who may be inside is decided by `space_access`
// (migration 094), never by `space_participants`.
//
//   table_read — the cast reads together; entry goes straight in.
//   audition   — actors wait in a lobby; the director admits one at a time.
//   callback   — like audition, but only actors the director invited by name.
//
// The director picks OPEN (listed on /social/auditions) or PRIVATE (invite code
// or named invite only) per room. Callbacks are always private.

export const TABLE_READ_FORMAT = "table_read" as const;
export const AUDITION_FORMAT = "audition" as const;
export const CALLBACK_FORMAT = "callback" as const;

export const AUDITION_ROOM_FORMATS = [
  TABLE_READ_FORMAT,
  AUDITION_FORMAT,
  CALLBACK_FORMAT,
] as const;

export type AuditionRoomFormat = (typeof AUDITION_ROOM_FORMATS)[number];

export function isAuditionFormat(
  format: string | null | undefined,
): format is AuditionRoomFormat {
  return (AUDITION_ROOM_FORMATS as readonly string[]).includes(format ?? "");
}

export const AUDITION_FORMAT_CONFIG: Record<
  AuditionRoomFormat,
  { label: string; blurb: string }
> = {
  table_read: {
    label: "Table Read",
    blurb: "The whole cast reads together, cameras on, one shared script.",
  },
  audition: {
    label: "Audition",
    blurb: "Actors wait in a lobby. You call them in one at a time.",
  },
  callback: {
    label: "Callback",
    blurb: "Shortlist only. Just the actors you invite by name can get in.",
  },
};

export const AUDITIONS_HOME = "/social/auditions";

export function auditionRoomHref(id: string): string {
  return `${AUDITIONS_HOME}/${id}`;
}

/** Callbacks are private no matter what the director ticked. */
export function resolveIsPrivate(
  format: AuditionRoomFormat,
  requestedPrivate: boolean,
): boolean {
  return format === CALLBACK_FORMAT ? true : requestedPrivate;
}

export type AccessStatus = "invited" | "lobby" | "admitted" | "denied";

export type EntryVia = "code" | "open-listing";

export type EntryDecision =
  | { ok: true; status: "lobby" | "admitted" }
  | { ok: false; reason: "denied" | "invite-only" | "private" };

/**
 * What happens when an actor walks up to the door.
 *
 * - A director's "denied" is final for that room.
 * - Someone already admitted stays admitted (reconnects keep their seat).
 * - Callbacks: only a named invite gets through; a leaked code alone does not.
 * - Private rooms: a code (or a named invite) is required.
 * - Table reads go straight in; auditions and callbacks wait in the lobby.
 */
export function decideEntry(input: {
  format: AuditionRoomFormat;
  isPrivate: boolean;
  via: EntryVia;
  existing: AccessStatus | null;
}): EntryDecision {
  const { format, isPrivate, via, existing } = input;
  if (existing === "denied") return { ok: false, reason: "denied" };
  if (existing === "admitted") return { ok: true, status: "admitted" };

  const invited = existing === "invited" || existing === "lobby";
  if (format === CALLBACK_FORMAT && !invited) {
    return { ok: false, reason: "invite-only" };
  }
  if (isPrivate && via !== "code" && !invited) {
    return { ok: false, reason: "private" };
  }
  return { ok: true, status: format === TABLE_READ_FORMAT ? "admitted" : "lobby" };
}

export type DirectorAction = "admit" | "lobby" | "deny";

export function nextStatusFor(action: DirectorAction): AccessStatus {
  if (action === "admit") return "admitted";
  if (action === "lobby") return "lobby";
  return "denied";
}

// Invite codes: no 0/O/1/I so a code read aloud on a call can't be misheard.
export const INVITE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const INVITE_CODE_LENGTH = 8;

export function generateInviteCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let out = "";
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    out += INVITE_CODE_ALPHABET[bytes[i] % INVITE_CODE_ALPHABET.length];
  }
  return out;
}

/** Accepts what people actually type: spaces, dashes, lower case. */
export function normalizeInviteCode(raw: unknown): string | null {
  const code = String(raw ?? "").toUpperCase().replace(/[\s-]/g, "");
  return /^[A-Z0-9]{6,12}$/.test(code) ? code : null;
}

// ---- Files -----------------------------------------------------------------

export type AuditionFileKind = "script" | "headshot" | "resume" | "reel";

export const AUDITION_FILE_MAX_BYTES = 15 * 1024 * 1024;

const UPLOAD_MIME: Record<Exclude<AuditionFileKind, "reel">, readonly string[]> = {
  script: ["application/pdf"],
  resume: ["application/pdf"],
  headshot: ["image/jpeg", "image/png", "image/webp"],
};

const MIME_EXT: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export function isAuditionFileKind(v: unknown): v is AuditionFileKind {
  return v === "script" || v === "headshot" || v === "resume" || v === "reel";
}

/** Scripts come from the director; everything else from the actor. */
export function canUploadKind(kind: AuditionFileKind, isDirector: boolean): boolean {
  return kind === "script" ? isDirector : true;
}

export function validateUpload(input: {
  kind: AuditionFileKind;
  mime: string;
  size: number;
}): { ok: true; ext: string } | { ok: false; error: string } {
  if (input.kind === "reel") {
    return { ok: false, error: "Reels are shared as a link" };
  }
  if (!UPLOAD_MIME[input.kind].includes(input.mime)) {
    return {
      ok: false,
      error: input.kind === "headshot" ? "Headshots must be JPG, PNG or WebP" : "Must be a PDF",
    };
  }
  if (!Number.isFinite(input.size) || input.size <= 0) {
    return { ok: false, error: "Empty file" };
  }
  if (input.size > AUDITION_FILE_MAX_BYTES) {
    return { ok: false, error: "Files must be 15 MB or smaller" };
  }
  return { ok: true, ext: MIME_EXT[input.mime] };
}

/** Reels are https links. Anything else (javascript:, http:, junk) is refused. */
export function normalizeReelUrl(raw: unknown): string | null {
  const s = String(raw ?? "").trim();
  if (s.length > 500) return null;
  try {
    const url = new URL(s);
    if (url.protocol !== "https:") return null;
    if (!url.hostname.includes(".")) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Object key inside the private audition-docs bucket. The space and the owner
 * are path segments so a leaked key still says whose and where; the random
 * name keeps keys unguessable.
 */
export function auditionFilePath(
  spaceId: string,
  ownerId: string,
  kind: AuditionFileKind,
  randomName: string,
  ext: string,
): string {
  return `${spaceId}/${ownerId}/${kind}-${randomName}.${ext}`;
}

/** Who may open a file: scripts — everyone inside; materials — owner + director. */
export function canReadFile(input: {
  kind: AuditionFileKind;
  ownerId: string;
  userId: string;
  isDirector: boolean;
  isAdmitted: boolean;
}): boolean {
  if (input.isDirector || input.ownerId === input.userId) return true;
  return input.kind === "script" && input.isAdmitted;
}
