"use client";

import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";
import type { AccessStatus, AuditionFileKind, AuditionRoomFormat } from "@/lib/auditions";

export interface AuditionProfile {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
}

export interface AuditionFile {
  id: string;
  owner_id: string;
  kind: AuditionFileKind;
  file_name: string | null;
  external_url: string | null;
  mime_type: string | null;
  created_at: string;
}

export interface AuditionPerson {
  user_id: string;
  status?: AccessStatus;
  character_name: string | null;
  updated_at?: string;
  profile?: AuditionProfile | null;
}

export interface AuditionTake {
  id: string;
  started_at: string;
  stopped_at: string | null;
  downloaded_at: string | null;
}

export interface AuditionView {
  room: {
    id: string;
    title: string;
    topic: string | null;
    status: string;
    room_format: AuditionRoomFormat;
    is_private: boolean;
    is_recording: boolean;
    host: AuditionProfile | null;
  };
  me: {
    id: string;
    is_host: boolean;
    is_director: boolean;
    access: AccessStatus | null;
    character_name: string | null;
    inside: boolean;
  };
  invite_code: string | null;
  state: { script_file_id: string | null; page: number; updated_at: string } | null;
  files: AuditionFile[];
  people: AuditionPerson[];
  recordings: AuditionTake[];
  max_recordings: number;
}

export class ApiError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(url, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data?.error ?? "Something went wrong", res.status);
  return data as T;
}

const post = <T,>(url: string, body: unknown) =>
  call<T>(url, { method: "POST", body: JSON.stringify(body) });

export const auditionsApi = {
  view: (id: string) => call<AuditionView>(`/api/auditions/${id}`),
  join: (body: { code: string } | { space_id: string }) =>
    post<{ status: string; href: string }>("/api/auditions/join", body),
  access: (id: string, body: Record<string, unknown>) => post(`/api/auditions/${id}/access`, body),
  setState: (id: string, body: { script_file_id?: string | null; page?: number }) =>
    post(`/api/auditions/${id}/state`, body),
  record: (id: string, action: "start" | "stop") => post(`/api/auditions/${id}/recording`, { action }),
  takeUrl: (id: string, takeId: string, download: boolean) =>
    call<{ url: string }>(`/api/auditions/${id}/recording?id=${takeId}${download ? "&download=1" : ""}`),
  fileUrl: (id: string, fileId: string, download = false) =>
    call<{ url: string }>(`/api/auditions/${id}/files?id=${fileId}${download ? "&download=1" : ""}`),
  deleteFile: (id: string, fileId: string) =>
    call(`/api/auditions/${id}/files?id=${fileId}`, { method: "DELETE" }),
  addReel: (id: string, url: string) => post(`/api/auditions/${id}/files`, { kind: "reel", url }),
  end: (id: string) => call(`/api/auditions/${id}`, { method: "DELETE" }),
  heartbeat: (id: string) =>
    authFetch(`/api/social/spaces/${id}/heartbeat`, { method: "POST" }).catch(() => undefined),

  /** Signed two-step upload: the row only exists once the object has landed. */
  async upload(id: string, kind: Exclude<AuditionFileKind, "reel">, file: File) {
    const meta = { kind, file_name: file.name, content_type: file.type, size: file.size };
    const { path, token } = await post<{ path: string; token: string }>(
      `/api/auditions/${id}/files`,
      { step: "upload-url", ...meta },
    );
    const { error } = await supabase.storage
      .from("audition-docs")
      .uploadToSignedUrl(path, token, file, { contentType: file.type });
    if (error) throw new ApiError("Upload failed. Check your connection and try again.", 0);
    return post<{ id: string }>(`/api/auditions/${id}/files`, { step: "confirm", path, ...meta });
  },
};

export function displayName(p: AuditionProfile | null | undefined): string {
  return p?.display_name || (p?.username ? `@${p.username}` : "Member");
}
