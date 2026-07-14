"use client";

import { useCallback, useState } from "react";
import { authHeaders } from "@/lib/authClient";
import type { RadioTrack } from "@/lib/data";

export interface SavedPlaylist {
  id: string;
  name: string;
  trackCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TrackRef {
  sourceType: "legacy" | "studio";
  id: number | string;
}

async function jsonHeaders() {
  return { "Content-Type": "application/json", ...(await authHeaders()) };
}

// Thin client wrapper over /api/radio/playlists*. Keeps RadioClient tidy and
// centralizes the authFetch plumbing.
export function usePlaylists() {
  const [playlists, setPlaylists] = useState<SavedPlaylist[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/radio/playlists", {
        cache: "no-store",
        headers: await authHeaders(),
      });
      if (res.status === 401) {
        setPlaylists([]);
        return;
      }
      if (!res.ok) throw new Error("failed");
      const data = await res.json();
      setPlaylists(data.playlists ?? []);
    } catch {
      setError("Couldn't load your playlists.");
    } finally {
      setLoading(false);
    }
  }, []);

  const create = useCallback(async (name: string): Promise<SavedPlaylist | null> => {
    const res = await fetch("/api/radio/playlists", {
      method: "POST",
      headers: await jsonHeaders(),
      body: JSON.stringify({ name }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    await refresh();
    return data.playlist ?? null;
  }, [refresh]);

  const rename = useCallback(async (id: string, name: string): Promise<boolean> => {
    const res = await fetch(`/api/radio/playlists/${id}`, {
      method: "PATCH",
      headers: await jsonHeaders(),
      body: JSON.stringify({ name }),
    });
    if (res.ok) await refresh();
    return res.ok;
  }, [refresh]);

  const remove = useCallback(async (id: string): Promise<boolean> => {
    const res = await fetch(`/api/radio/playlists/${id}`, {
      method: "DELETE",
      headers: await authHeaders(),
    });
    if (res.ok) await refresh();
    return res.ok;
  }, [refresh]);

  const addTrack = useCallback(async (playlistId: string, ref: TrackRef): Promise<boolean> => {
    const res = await fetch(`/api/radio/playlists/${playlistId}/tracks`, {
      method: "POST",
      headers: await jsonHeaders(),
      body: JSON.stringify(ref),
    });
    return res.ok;
  }, []);

  const removeTrack = useCallback(async (playlistId: string, ref: TrackRef): Promise<boolean> => {
    const res = await fetch(`/api/radio/playlists/${playlistId}/tracks`, {
      method: "DELETE",
      headers: await jsonHeaders(),
      body: JSON.stringify(ref),
    });
    return res.ok;
  }, []);

  const containing = useCallback(async (ref: TrackRef): Promise<string[]> => {
    const res = await fetch(
      `/api/radio/playlists/containing?sourceType=${ref.sourceType}&id=${encodeURIComponent(String(ref.id))}`,
      { cache: "no-store", headers: await authHeaders() },
    );
    if (!res.ok) return [];
    const data = await res.json();
    return data.playlistIds ?? [];
  }, []);

  const getTracks = useCallback(async (
    playlistId: string,
  ): Promise<{ name: string; tracks: RadioTrack[] } | null> => {
    const res = await fetch(`/api/radio/playlists/${playlistId}/tracks`, {
      cache: "no-store",
      headers: await authHeaders(),
    });
    if (!res.ok) return null;
    return res.json();
  }, []);

  return {
    playlists,
    loading,
    error,
    refresh,
    create,
    rename,
    remove,
    addTrack,
    removeTrack,
    containing,
    getTracks,
  };
}
