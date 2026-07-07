"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import TrackUploader from "./components/TrackUploader";
import VideoUploader from "./components/VideoUploader";
import VideoList from "./components/VideoList";
import WaveformEditor from "./components/WaveformEditor";
import TrackList from "./components/TrackList";
import AnalyticsPanel from "./components/AnalyticsPanel";
import ReleaseScheduler from "./components/ReleaseScheduler";
import ProfilePhotoUploader from "./components/ProfilePhotoUploader";
import PayoutsPanel from "./components/PayoutsPanel";
import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";

type Tab =
  | "upload"
  | "video"
  | "tracks"
  | "waveform"
  | "analytics"
  | "schedule"
  | "profile"
  | "payouts";

export default function StudioPage() {
  const [activeTab, setActiveTab] = useState<Tab>("upload");
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  // Caller uid, used by VideoList to filter the public feed down to the
  // artist's own uploads. StudioGuard already gates the whole page on an
  // authenticated artist, so this session lookup is guaranteed to resolve.
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setUserId(data.session?.user?.id ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEditWaveform = useCallback((trackId: string) => {
    setSelectedTrackId(trackId);
    setActiveTab("waveform");
  }, []);

  // Returning from the Stripe account link lands on /studio?connect=return|refresh
  // (or /studio?purchase=...) — open the Payouts tab so the artist sees status.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.has("connect") || params.has("purchase")) {
      setActiveTab("payouts");
    }
  }, []);

  // Preload current profile photos when the Profile tab opens so the
  // uploader shows what's already saved instead of the empty placeholder.
  useEffect(() => {
    if (activeTab !== "profile") return;
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/artist/profile-media", { method: "GET" });
        if (!res.ok) return;
        const body = await res.json().catch(() => ({}) as any);
        if (cancelled) return;
        setAvatarUrl(body?.artist?.avatar_url ?? null);
        setCoverUrl(body?.artist?.cover_image_url ?? null);
      } catch {
        /* non-blocking preview */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "upload", label: "Upload", icon: "📤" },
    { id: "video", label: "Video", icon: "🎬" },
    { id: "tracks", label: "My Tracks", icon: "🎵" },
    { id: "waveform", label: "Preview Editor", icon: "✂️" },
    { id: "analytics", label: "Analytics", icon: "📊" },
    { id: "schedule", label: "Schedule", icon: "📅" },
    { id: "profile", label: "Profile Photos", icon: "\u{1F5BC}\uFE0F" },
    { id: "payouts", label: "Payouts", icon: "\uD83D\uDCB8" },
  ];

  return (
    <main className="min-h-screen w-full overflow-x-hidden bg-gradient-to-br from-[#0a0a0a] via-[#1a1a2e] to-[#0a0a0a] text-white">
      <div className="border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h1 className="text-3xl font-bold bg-gradient-to-r from-[#c9a96e] to-[#f0d99c] bg-clip-text text-transparent">
                Artist Studio
              </h1>
              <p className="text-[#888] text-sm mt-1">
                Upload, edit, and release your music — keep 90% of every sale.
              </p>
            </div>
            <Link
              href="/"
              className="text-sm text-[#888] hover:text-[#c9a96e] transition-colors"
            >
              ← Back to MELORI
            </Link>
          </div>
        </div>
      </div>

      <div className="border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-1 -mb-px overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-4 text-sm font-medium transition-all border-b-2 cursor-pointer flex items-center gap-2 whitespace-nowrap shrink-0
                  ${
                    activeTab === tab.id
                      ? "border-[#c9a96e] text-[#c9a96e]"
                      : "border-transparent text-[#888] hover:text-white hover:border-white/10"
                  }`}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === "upload" && <TrackUploader />}
        {activeTab === "video" && (
          <>
            <VideoUploader />
            <VideoList userId={userId} />
          </>
        )}
        {activeTab === "tracks" && (
          <TrackList onEditWaveform={handleEditWaveform} />
        )}
        {activeTab === "waveform" && (
          <WaveformEditor
            trackId={selectedTrackId}
            onBack={() => setActiveTab("tracks")}
          />
        )}
        {activeTab === "analytics" && <AnalyticsPanel />}
        {activeTab === "schedule" && <ReleaseScheduler />}
        {activeTab === "payouts" && <PayoutsPanel />}
        {activeTab === "profile" && (
      <div className="space-y-8 max-w-xl">
        <div>
          <h2 className="text-lg font-semibold mb-1">Profile picture</h2>
          <p className="text-[#888] text-sm mb-3">Shown on your artist page and featured-artist cards.</p>
          <ProfilePhotoUploader
            slot="avatar"
            label="Profile picture"
            shape="circle"
            currentUrl={avatarUrl}
            onUploaded={(url) => setAvatarUrl(url)}
          />
          </div>
        <div>
          <h2 className="text-lg font-semibold mb-1">Top bar photo</h2>
          <p className="text-[#888] text-sm mb-3">The wide banner across the top of your artist page.</p>
          <ProfilePhotoUploader
            slot="cover"
            label="Top bar photo"
            shape="banner"
            currentUrl={coverUrl}
            onUploaded={(url) => setCoverUrl(url)}
          />
          </div>
        </div>
      )}
      </div>
    </main>
  );
}
