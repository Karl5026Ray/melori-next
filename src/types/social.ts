export type UserRole = "artist" | "superfan" | "admin" | "free";

export interface Profile {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: UserRole;
  bio: string | null;
  verified: boolean;
  followers_count: number;
  following_count: number;
  created_at?: string;
  // Membership (Supabase profiles). See src/lib/membership.ts for gating rules.
  membership_tier?: string | null;
  membership_status?: string | null;
  membership_expires_at?: string | null;
}

export type SpaceType = "listening" | "discussion" | "creation" | "dj_set";
export type SpaceStatus = "scheduled" | "live" | "ended";

export type RoomFormat =
  | "release_party"
  | "discussion"
  | "versus_battle"
  | "dj_set";

// Shared format → badge presentation. Used by SpaceCard and the room detail
// header so labels/variants stay consistent. Legacy rows with a null
// room_format fall back to `discussion` (see ROOM_FORMAT_FALLBACK).
export const ROOM_FORMAT_CONFIG: Record<
  RoomFormat,
  { variant: "green" | "purple" | "pink" | "orange"; label: string }
> = {
  release_party: { variant: "green", label: "Release Party" },
  discussion: { variant: "purple", label: "Discussion" },
  versus_battle: { variant: "pink", label: "Versus Battle" },
  dj_set: { variant: "orange", label: "DJ Set" },
};

export const ROOM_FORMAT_FALLBACK: RoomFormat = "discussion";

export function getRoomFormatConfig(format: RoomFormat | null | undefined) {
  return ROOM_FORMAT_CONFIG[format ?? ROOM_FORMAT_FALLBACK];
}

export interface Space {
  id: string;
  title: string;
  topic: string;
  type: SpaceType;
  room_format?: RoomFormat | null;
  status: SpaceStatus;
  host_id: string;
  host?: Profile;
  participant_count: number;
  max_participants: number;
  created_at: string;
  ended_at: string | null;
  agora_channel: string | null;
  scheduled_at?: string | null;
  last_activity_at?: string | null;
}

export type WaveStatus = "pending" | "accepted" | "declined" | "expired";

export interface Wave {
  id: string;
  sender_id: string;
  recipient_id: string;
  message: string | null;
  status: WaveStatus;
  conversation_id: string | null;
  created_at: string;
  expires_at: string;
  responded_at: string | null;
  sender?: Profile;
  recipient?: Profile;
}

export type ParticipantRole = "host" | "speaker" | "audience";

export interface SpaceParticipant {
  id: string;
  space_id: string;
  user_id: string;
  user?: Profile;
  role: ParticipantRole;
  joined_at: string;
  left_at: string | null;
  is_speaking: boolean;
  is_muted: boolean;
  has_raised_hand: boolean;
  // Set by the host via force-mute; clients respect this even if the speaker
  // toggles their own is_muted back off.
  host_muted?: boolean;
}

export interface Conversation {
  id: string;
  created_at: string;
  updated_at: string;
  members?: ConversationMember[];
  last_message?: Message;
  unread_count?: number;
}

export interface ConversationMember {
  id: string;
  conversation_id: string;
  user_id: string;
  user?: Profile;
  joined_at: string;
  last_read_at: string | null;
}

export interface Message {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender?: Profile;
  content: string;
  created_at: string;
  is_edited: boolean;
}

export interface SocialVideo {
  id: string;
  user_id: string;
  user?: Profile;
  title: string;
  description: string | null;
  video_url: string;
  thumbnail_url: string | null;
  likes_count: number;
  comments_count: number;
  created_at: string;
}

export interface Follow {
  id: string;
  follower_id: string;
  following_id: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: "follow" | "message" | "space_invite" | "mention";
  data: Record<string, any>;
  read: boolean;
  created_at: string;
}
