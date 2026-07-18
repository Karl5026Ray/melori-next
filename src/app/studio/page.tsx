"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import TrackUploader from "./components/TrackUploader";
import VideoUploader from "./components/VideoUploader";
import VideoList from "./components/VideoList";
import HumanizerWorkspace from "./components/humanizer/HumanizerWorkspace";
import TrackList from "./components/TrackList";
import WaveformEditor from "./components/WaveformEditor";
import AnalyticsPanel from "./components/AnalyticsPanel";
import ReleaseScheduler from "./components/ReleaseScheduler";
import ProfilePhotoUploader from "./components/ProfilePhotoUploader";
import PayoutsPanel from "./components/PayoutsPanel";
import SuperfansPanel from "./components/SuperfansPanel";
import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";

type Tab =
  | "upload"
  | "video"
  | "tracks"
  | "clip"
  | "humanizer"
  | "analytics"
  | "superfans"
  | "schedule"
  | "profile"
  | "payouts";

export default function StudioPage() {
  const [activeTab, setActiveTab] = useState<Tab>("upload");
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  // Editable profile details for the Profile tab. Saved via PATCH
  // /api/social/profile, the same endpoint the social EditProfileModal uses.
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  // Caller uid, used by VideoList to filter the public feed down to the
  // artist's own uploads. StudioGuard already gates the whole page on an
  // authenticated artist, so this session lookup is guaranteed to resolve.
  const [userId, setUserId] = useState<string | null>(null);
  // Artist display name for the studio header. Falls back to full_name /
  // email localpart so the header still personalizes when display_name isn't set.
  const [artistName, setArtistName] = useState<string | null>(null);
  // Whether this artist has an explicit admin grant for the Humanizer's
  // forensic-resistance layer. Read directly from humanizer_access with the
  // browser (anon) client — RLS's "own access read" policy scopes this to the
  // signed-in user's own row, so no dedicated API route is needed just to
  // read this one flag.
  const [canForensic, setCanForensic] = useState(false);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(async ({ data }) => {
      const uid = data.session?.user?.id ?? null;
      const email = data.session?.user?.email ?? null;
      if (!cancelled) setUserId(uid);
      if (!uid) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name, full_name")
        .eq("id", uid)
        .maybeSingle();
      if (cancelled) return;
      const resolved =
        profile?.display_name?.trim() ||
        profile?.full_name?.trim() ||
        (email ? email.split("@")[0] : null);
      setArtistName(resolved);

      const { data: access } = await supabase
        .from("humanizer_access")
        .select("can_forensic")
        .eq("user_id", uid)
        .maybeSingle();
      if (!cancelled) setCanForensic(access?.can_forensic === true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Open the 30-second clip maker (WaveformEditor) for a specific track.
  // Switches to the dedicated "clip" top tab with the chosen track loaded.
  // The Humanizer tab is a separate, independent surface and must not be
  // triggered from the per-track Preview button.
  const handleEditWaveform = useCallback((trackId: string) => {
    setSelectedTrackId(trackId);
    setActiveTab("clip");
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

      // Preload the editable profile fields (name / username / bio) from the
      // resilient /api/user/me source so the form isn't empty.
      try {
        const meRes = await authFetch("/api/user/me", { method: "GET" });
        if (!meRes.ok) return;
        const me = await meRes.json().catch(() => ({}) as any);
        if (cancelled) return;
        const p = me?.profile ?? {};
        setDisplayName(p.display_name || p.full_name || "");
        setUsername(p.username ?? "");
        setBio(p.bio ?? "");
      } catch {
        /* non-blocking preload */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  // Save the profile details — mirrors EditProfileModal.handleSave: PATCH
  // /api/social/profile with { display_name, username, bio }, then feedback.
  const handleSaveProfile = async () => {
    setProfileError(null);
    setProfileSaved(false);
    const dn = displayName.trim();
    if (!dn) {
      setProfileError("Display name is required.");
      return;
    }
    setSavingProfile(true);
    try {
      const res = await authFetch("/api/social/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: dn,
          username: username.trim().toLowerCase() || undefined,
          bio: bio.trim() ? bio.trim() : null,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Save failed");
      }
      setArtistName(dn);
      setProfileSaved(true);
      if (typeof window !== "undefined") {
        const { profile } = await res.json().catch(() => ({ profile: null }));
        if (profile) {
          window.dispatchEvent(
            new CustomEvent("melori:profile-updated", { detail: profile }),
          );
        }
      }
    } catch (err: any) {
      setProfileError(err?.message ?? "Could not save profile.");
    } finally {
      setSavingProfile(false);
    }
  };

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "upload", label: "Upload", icon: "📤" },
    { id: "video", label: "Video", icon: "🎬" },
    { id: "tracks", label: "My Tracks", icon: "🎵" },
    { id: "clip", label: "Clip Maker", icon: "✂️" },
    { id: "humanizer", label: "Humanizer", icon: "🎛️" },
    { id: "analytics", label: "Analytics", icon: "📊" },
    { id: "superfans", label: "Superfans", icon: "⭐" },
    { id: "schedule", label: "Schedule", icon: "📅" },
    { id: "profile", label: "Profile", icon: "\u{1F5BC}\uFE0F" },
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
              {artistName && (
                <p className="text-white/90 text-base font-medium mt-1 truncate">
                  {artistName}
                </p>
              )}
              <p className="text-[#888] text-sm mt-1">
                Upload, edit, and release your music — keep 100% of every sale.
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
        {activeTab === "clip" && (
          <WaveformEditor
            trackId={selectedTrackId}
            onBack={() => setActiveTab("tracks")}
          />
        )}
        {activeTab === "humanizer" && (
          <HumanizerWorkspace canForensic={canForensic} />
        )}
        {activeTab === "analytics" && <AnalyticsPanel />}
        {activeTab === "superfans" && <SuperfansPanel />}
        {activeTab === "schedule" && <ReleaseScheduler />}
        {activeTab === "payouts" && <PayoutsPanel />}
        {activeTab === "profile" && (
      <div className="space-y-8 max-w-xl">
        <div className="space-y-4">
          <div>
            <h2 className="text-lg font-semibold mb-1">Profile details</h2>
            <p className="text-[#888] text-sm">
              Your public name, handle, and bio.
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#888] mb-1">
              Display name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={50}
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a96e] transition"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#888] mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={30}
              placeholder="unique_handle"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a96e] transition"
            />
            <p className="mt-1 text-xs text-[#666]">
              3–30 chars · lowercase letters, numbers, underscore, dot
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-[#888] mb-1">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={500}
              placeholder="Say something about yourself…"
              className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a96e] transition resize-none"
            />
            <p className="mt-1 text-xs text-[#666] text-right">{bio.length}/500</p>
          </div>
          {profileError && (
            <p className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
              {profileError}
            </p>
          )}
          {profileSaved && (
            <p className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-300">
              Profile saved.
            </p>
          )}
          <button
            type="button"
            onClick={handleSaveProfile}
            disabled={savingProfile}
            className="px-6 py-2.5 rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-semibold text-sm disabled:opacity-50 transition"
          >
            {savingProfile ? "Saving…" : "Save profile"}
          </button>
        </div>
        <div className="border-t border-white/[0.06] pt-8">
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
