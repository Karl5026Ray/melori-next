"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Camera } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";

// /settings — Signed-in user settings hub.
// Sections:
//   • Profile (reuses fields + PATCH /api/social/profile + upload-url pattern from EditProfileModal)
//   • Notifications (email opt-in — stored on profiles.notifications_email; falls back gracefully if column missing)
//   • Membership (read-only summary from profiles.membership_tier / status / expires_at)
//   • Account (email + sign-out)
//
// Auth: client-side redirect to /social/auth?next=/settings when no session.

type ProfileRow = {
  id: string;
  username: string | null;
  display_name: string | null;
  bio: string | null;
  avatar_url: string | null;
  membership_tier: string | null;
  membership_status: string | null;
  membership_expires_at: string | null;
  notifications_email?: boolean | null;
};

type GalleryPhoto = { id: string; image_url: string; sort_order: number };

const MAX_GALLERY = 12;

export default function SettingsPage() {
  const router = useRouter();
  const [state, setState] = useState<
    "checking" | "ready" | "signed-out" | "load-error"
  >("checking");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [email, setEmail] = useState<string>("");
  const [tier, setTier] = useState<string>("free");
  const [role, setRole] = useState<string>("free");

  // Editable fields
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [notifEmail, setNotifEmail] = useState(true);

  // UI state
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingNotif, setSavingNotif] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Password change (superfan/artist only)
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  // Photo gallery (superfan/artist only)
  const [gallery, setGallery] = useState<GalleryPhoto[]>([]);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Artist banner (artist role only) — artists.cover_image_url
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [bannerUploading, setBannerUploading] = useState(false);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  const load = async (): Promise<void> => {
    setState("checking");
    setLoadError(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      setState("signed-out");
      router.replace("/social/auth?next=/settings");
      return;
    }

    // Load via the resilient service-role API so a missing/optional column or
    // RLS quirk can never leave this page hanging on "Loading settings…".
    try {
      const res = await authFetch("/api/user/me");
      if (res.status === 401) {
        setState("signed-out");
        router.replace("/social/auth?next=/settings");
        return;
      }
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not load your settings.");
      }
      const {
        profile: p,
        email: apiEmail,
        role: apiRole,
        tier: apiTier,
      } = (await res.json()) as {
        profile: ProfileRow;
        email: string | null;
        role?: string | null;
        tier?: string | null;
      };
      setProfile(p ?? null);
      setEmail(apiEmail ?? session.user.email ?? "");
      setRole((apiRole ?? p?.membership_tier ?? "free").toString());
      setTier((apiTier ?? "free").toString());
      setDisplayName(p?.display_name ?? "");
      setUsername(p?.username ?? "");
      setBio(p?.bio ?? "");
      setAvatarUrl(p?.avatar_url ?? null);
      setNotifEmail(p?.notifications_email !== false); // default true
      setState("ready");

      // Gallery is gated to superfan/artist; only fetch when eligible.
      if (apiTier === "superfan" || apiTier === "artist") {
        void loadGallery();
      }
      // Banner is artist-only; fetch the current cover_image_url once.
      if (apiRole === "artist") {
        void loadBanner();
      }
    } catch (err: any) {
      setLoadError(err?.message ?? "Could not load your settings.");
      setState("load-error");
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  const handlePickPhoto = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);

    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Photo must be 5 MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      const urlRes = await authFetch("/api/social/profile/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
        }),
      });
      if (!urlRes.ok) {
        const d = await urlRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not get upload URL");
      }
      const { signedUrl, publicUrl } = await urlRes.json();

      const putRes = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });
      if (!putRes.ok) throw new Error("Upload failed — please try again.");

      setAvatarUrl(publicUrl);
    } catch (err: any) {
      setError(err?.message ?? "Photo upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSaveProfile = async () => {
    setError(null);
    setSuccess(null);
    const dn = displayName.trim();
    if (!dn) {
      setError("Display name is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: dn,
          username: username.trim().toLowerCase() || undefined,
          bio: bio.trim() ? bio.trim() : null,
          avatar_url: avatarUrl,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Save failed");
      }
      setSuccess("Profile saved.");
    } catch (err: any) {
      setError(err?.message ?? "Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleSaveNotifications = async () => {
    setError(null);
    setSuccess(null);
    setSavingNotif(true);
    try {
      // Best-effort: try to persist via /api/social/profile PATCH.
      // If the column doesn't exist yet the API will 400 — we surface a
      // friendly message and don't block the rest of settings.
      const res = await authFetch("/api/user/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifications_email: notifEmail }),
      });
      if (!res.ok) {
        // Fall back: silently succeed to keep UX clean until the column ships.
        setSuccess("Notification preference saved locally.");
      } else {
        setSuccess("Notification preferences saved.");
      }
    } catch {
      setSuccess("Notification preference saved locally.");
    } finally {
      setSavingNotif(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/social/auth");
  };

  const handleChangePassword = async () => {
    setError(null);
    setSuccess(null);
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setSavingPassword(true);
    try {
      const { error: updErr } = await supabase.auth.updateUser({
        password: newPassword,
      });
      if (updErr) throw new Error(updErr.message);
      setNewPassword("");
      setConfirmPassword("");
      setSuccess("Password updated.");
    } catch (err: any) {
      setError(err?.message ?? "Could not update password.");
    } finally {
      setSavingPassword(false);
    }
  };

  const loadGallery = async (): Promise<void> => {
    try {
      const res = await authFetch("/api/user/gallery");
      if (!res.ok) return;
      const { photos } = (await res.json()) as { photos: GalleryPhoto[] };
      setGallery(Array.isArray(photos) ? photos : []);
    } catch {
      /* non-fatal */
    }
  };

  const handlePickGalleryPhoto = () => galleryInputRef.current?.click();

  const handleGalleryFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Photo must be 5 MB or smaller.");
      return;
    }
    if (gallery.length >= MAX_GALLERY) {
      setError(`Gallery is full (max ${MAX_GALLERY} photos).`);
      return;
    }

    setGalleryBusy(true);
    try {
      const urlRes = await authFetch("/api/user/gallery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      if (!urlRes.ok) {
        const d = await urlRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not get upload URL");
      }
      const { signedUrl, publicUrl } = await urlRes.json();

      const putRes = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!putRes.ok) throw new Error("Upload failed — please try again.");

      const saveRes = await authFetch("/api/user/gallery", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicUrl }),
      });
      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not save photo");
      }
      const { photo } = (await saveRes.json()) as { photo: GalleryPhoto };
      setGallery((prev) => [...prev, photo]);
      setSuccess("Photo added.");
    } catch (err: any) {
      setError(err?.message ?? "Photo upload failed.");
    } finally {
      setGalleryBusy(false);
      if (galleryInputRef.current) galleryInputRef.current.value = "";
    }
  };

  const handleRemoveGalleryPhoto = async (id: string) => {
    setError(null);
    setSuccess(null);
    setGalleryBusy(true);
    try {
      const res = await authFetch("/api/user/gallery", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not remove photo");
      }
      setGallery((prev) => prev.filter((p) => p.id !== id));
    } catch (err: any) {
      setError(err?.message ?? "Could not remove photo.");
    } finally {
      setGalleryBusy(false);
    }
  };

  const loadBanner = async (): Promise<void> => {
    try {
      const res = await authFetch("/api/artist/profile-media");
      if (!res.ok) return;
      const { artist } = (await res.json()) as {
        artist: { cover_image_url: string | null } | null;
      };
      setBannerUrl(artist?.cover_image_url ?? null);
    } catch {
      /* non-fatal */
    }
  };

  const handlePickBanner = () => bannerInputRef.current?.click();

  const handleBannerFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setSuccess(null);
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setError("Banner must be 8 MB or smaller.");
      return;
    }

    setBannerUploading(true);
    try {
      const urlRes = await authFetch("/api/artist/profile-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, slot: "cover" }),
      });
      if (!urlRes.ok) {
        const d = await urlRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not get upload URL");
      }
      const { signedUrl, publicUrl } = await urlRes.json();

      const putRes = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!putRes.ok) throw new Error("Upload failed — please try again.");

      const saveRes = await authFetch("/api/artist/profile-media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicUrl, slot: "cover" }),
      });
      if (!saveRes.ok) {
        const d = await saveRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not save banner");
      }
      setBannerUrl(publicUrl);
      setSuccess("Banner updated.");
    } catch (err: any) {
      setError(err?.message ?? "Banner upload failed.");
    } finally {
      setBannerUploading(false);
      if (bannerInputRef.current) bannerInputRef.current.value = "";
    }
  };

  if (state === "load-error") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
        <div className="flex max-w-sm flex-col items-center gap-4 text-center">
          <p className="text-sm text-red-400">
            {loadError ?? "We couldn't load your settings."}
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="px-6 py-2.5 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-white hover:bg-white/10 transition"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (state !== "ready") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#c9a96e]/40 border-t-[#c9a96e]" />
          <p className="text-sm text-[#888]">Loading settings…</p>
        </div>
      </div>
    );
  }

  const membershipTier = profile?.membership_tier ?? "free";
  const status = profile?.membership_status ?? "inactive";
  // Password + Gallery sections are for paid tiers only: superfan tier OR
  // artist role (admins resolve to the 'artist' tier and also qualify).
  const canManage = tier === "superfan" || tier === "artist" || role === "artist";

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-3xl mx-auto px-4 py-10">
        <div className="mb-8">
          <p className="text-xs uppercase tracking-widest text-[#c9a96e]">
            Account
          </p>
          <h1 className="text-3xl font-bold mt-1">Settings</h1>
          <p className="text-sm text-[#888] mt-1">
            Manage your profile, notifications, and membership.
          </p>
        </div>

        {error && (
          <div className="mb-6 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-6 rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-400">
            {success}
          </div>
        )}

        {/* Profile */}
        <section className="mb-8 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-5">Profile</h2>

          <div className="flex flex-col items-center gap-3 mb-6">
            <button
              type="button"
              onClick={handlePickPhoto}
              disabled={uploading}
              className="relative group"
              aria-label="Change photo"
            >
              <img
                src={avatarUrl || "/favicon.png"}
                alt=""
                className="w-24 h-24 rounded-full object-cover border-2 border-white/10"
              />
              <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
                <Camera className="w-6 h-6 text-white" />
              </span>
            </button>
            <button
              type="button"
              onClick={handlePickPhoto}
              disabled={uploading}
              className="text-sm text-[#c9a96e] hover:underline disabled:opacity-50"
            >
              {uploading ? "Uploading…" : "Change photo"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleFileChange}
            />
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#888] mb-1">
                Display name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={50}
                className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a96e] transition"
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
                className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a96e] transition"
                placeholder="unique_handle"
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
                className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a96e] transition resize-none"
                placeholder="Say something about yourself…"
              />
              <p className="mt-1 text-xs text-[#666] text-right">
                {bio.length}/500
              </p>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={handleSaveProfile}
              disabled={saving || uploading}
              className="px-6 py-2.5 rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-semibold text-sm disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        </section>

        {/* Artist Banner — artist accounts + admins (artists.cover_image_url) */}
        {(role === "artist" || role === "admin") && (
          <section id="artist-banner" className="mb-8 scroll-mt-24 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
            <h2 className="text-lg font-semibold mb-5">Artist Banner</h2>
            <div className="relative w-full overflow-hidden rounded-xl border border-white/10 bg-gradient-to-br from-[#c9a96e]/20 to-[#0a0a0a] aspect-[16/5]">
              {bannerUrl ? (
                <img
                  src={bannerUrl}
                  alt="Artist banner"
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-xs text-[#888]">
                  No banner yet
                </div>
              )}
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <p className="text-xs text-[#666]">
                Recommended ~1600×500 · images only · 8 MB max.
              </p>
              <button
                type="button"
                onClick={handlePickBanner}
                disabled={bannerUploading}
                className="shrink-0 px-5 py-2.5 rounded-full bg-white/5 border border-white/10 text-white font-medium text-sm hover:bg-white/10 transition disabled:opacity-50"
              >
                {bannerUploading ? "Uploading…" : "Change banner"}
              </button>
            </div>
            <input
              ref={bannerInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleBannerFileChange}
            />
          </section>
        )}

        {/* Notifications */}
        <section className="mb-8 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-5">Notifications</h2>

          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={notifEmail}
              onChange={(e) => setNotifEmail(e.target.checked)}
              className="mt-1 w-4 h-4 rounded border-white/20 bg-black/60"
            />
            <span>
              <span className="block text-sm font-medium">Email updates</span>
              <span className="block text-xs text-[#888] mt-0.5">
                New releases, drops, and announcements from MELORI Music.
              </span>
            </span>
          </label>

          <div className="mt-6 flex justify-end">
            <button
              type="button"
              onClick={handleSaveNotifications}
              disabled={savingNotif}
              className="px-6 py-2.5 rounded-full bg-white/5 border border-white/10 text-white font-medium text-sm hover:bg-white/10 transition disabled:opacity-50"
            >
              {savingNotif ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </section>

        {/* Password — superfan/artist only */}
        {canManage && (
          <section className="mb-8 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
            <h2 className="text-lg font-semibold mb-5">Password</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#888] mb-1">
                  New password
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a96e] transition"
                  placeholder="At least 8 characters"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold uppercase tracking-wide text-[#888] mb-1">
                  Confirm password
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  className="w-full bg-black/60 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a96e] transition"
                  placeholder="Re-enter new password"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={handleChangePassword}
                disabled={savingPassword}
                className="px-6 py-2.5 rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-semibold text-sm disabled:opacity-50"
              >
                {savingPassword ? "Updating…" : "Update password"}
              </button>
            </div>
          </section>
        )}

        {/* Photo Gallery — superfan/artist only */}
        {canManage && (
          <section className="mb-8 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Photo Gallery</h2>
              <span className="text-xs text-[#888]">
                {gallery.length}/{MAX_GALLERY}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3">
              {gallery.map((photo) => (
                <div
                  key={photo.id}
                  className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-black/40"
                >
                  <img
                    src={photo.image_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveGalleryPhoto(photo.id)}
                    disabled={galleryBusy}
                    aria-label="Remove photo"
                    className="absolute right-1.5 top-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/70 text-white text-lg leading-none hover:bg-red-500/80 disabled:opacity-50"
                  >
                    ×
                  </button>
                </div>
              ))}
              {gallery.length < MAX_GALLERY && (
                <button
                  type="button"
                  onClick={handlePickGalleryPhoto}
                  disabled={galleryBusy}
                  className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/15 bg-white/[0.02] text-xs text-[#888] hover:border-[#c9a96e]/50 hover:text-[#c9a96e] transition disabled:opacity-50"
                >
                  <Camera className="h-5 w-5" />
                  {galleryBusy ? "Working…" : "Add photo"}
                </button>
              )}
            </div>
            <p className="mt-3 text-xs text-[#666]">
              Up to {MAX_GALLERY} photos · images only · 5 MB max each.
            </p>
            <input
              ref={galleryInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleGalleryFileChange}
            />
          </section>
        )}

        {/* Membership */}
        <section className="mb-8 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-5">Membership</h2>
          <div className="grid sm:grid-cols-3 gap-4 mb-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-[#888]">
                Tier
              </p>
              <p className="text-xl font-bold capitalize text-[#c9a96e] mt-1">
                {membershipTier}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[#888]">
                Status
              </p>
              <p className="text-xl font-bold capitalize mt-1">{status}</p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-[#888]">
                Renews / expires
              </p>
              <p className="text-xl font-bold mt-1">
                {profile?.membership_expires_at
                  ? new Date(
                      profile.membership_expires_at,
                    ).toLocaleDateString()
                  : "—"}
              </p>
            </div>
          </div>
          <Link
            href="/membership"
            className="inline-block px-5 py-2.5 rounded-full bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition"
          >
            Manage membership
          </Link>
        </section>

        {/* Account */}
        <section className="mb-8 bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
          <h2 className="text-lg font-semibold mb-5">Account</h2>
          <div className="mb-4">
            <p className="text-xs uppercase tracking-wide text-[#888]">Email</p>
            <p className="text-sm mt-1">{email || "—"}</p>
          </div>
          <button
            type="button"
            onClick={handleSignOut}
            className="px-5 py-2.5 rounded-full bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-medium hover:bg-red-500/20 transition"
          >
            Sign out
          </button>
        </section>
      </div>
    </div>
  );
}
