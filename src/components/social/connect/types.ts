// Shared client types for Melori Connect UI. Mirrors the shapes returned by the
// /api/social/connect/* routes and src/lib/dating.ts.

export interface HarmonyResult {
  score: number;
  explanation: string[];
}

export interface ConnectCard {
  profile_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  age: number | null;
  intent: string;
  shown_gender: string | null;
  bio_override: string | null;
  verified: boolean;
  photo_url: string | null;
  prompt_preview: { text: string; answer: string } | null;
  harmony: HarmonyResult;
}

export interface ConnectMatchSummary {
  match_id: string;
  created_at: string;
  other: {
    id: string;
    username: string | null;
    display_name: string;
    avatar_url: string | null;
    photo_url: string | null;
  };
  last_message: {
    body: string;
    from_me: boolean;
    created_at: string;
    unread: boolean;
  } | null;
}

export interface ConnectMessage {
  id: string;
  match_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  from_me: boolean;
}

export interface DatingProfile {
  profile_id: string;
  is_active: boolean;
  dob: string;
  over_18: boolean;
  intent: string;
  shown_gender: string | null;
  seeking_gender: string[];
  age_min: number;
  age_max: number;
  max_distance_km: number;
  bio_override: string | null;
  verified: boolean;
  consent_sensitive: boolean;
}

export interface PromptOption {
  id: number;
  text: string;
}

export const REPORT_CATEGORIES: { value: string; label: string }[] = [
  { value: "harassment", label: "Harassment or abuse" },
  { value: "fake_profile", label: "Fake or impersonating profile" },
  { value: "underage", label: "Appears to be under 18" },
  { value: "ncii", label: "Intimate images shared without consent (NCII)" },
  { value: "other", label: "Something else" },
];
