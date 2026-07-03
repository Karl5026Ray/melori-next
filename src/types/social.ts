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
}

export type SpaceType = "listening" | "discussion" | "creation" | "dj_set";
export type SpaceStatus = "scheduled" | "live" | "ended";

export interface Space {
  id: string;
  title: string;
  topic: string;
  type: SpaceType;
  status: SpaceStatus;
  host_id: string;
  host?: Profile;
  participant_count: number;
  max_participants: number;
  created_at: string;
  ended_at: string | null;
  agora_channel: string | null;
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
