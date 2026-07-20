"use client";

import { useEffect, useRef, useState } from "react";
import { X, Camera } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import type { Profile } from "@/types/social";

interface EditProfileModalProps {
  user: Profile;
  onClose: () => void;
  onSaved: (updated: Profile) => void;
}

// Modal for editing the signed-in user's MM Social profile.
// - display_name / username / bio go via PATCH /api/social/profile
// - avatar upload uses POST /api/social/profile/upload-url → PUT signedUrl
//   → PATCH profile with the new avatar_url so the change persists across
//   sessions.
export default function EditProfileModal({
  user,
  onClose,
  onSaved,
}: EditProfileModalProps) {
  const [displayName, setDisplayName] = useState(user.display_name ?? "");
  const [username, setUsername] = useState(user.username ?? "");
  const [bio, setBio] = useState(user.bio ?? "");
  const [birthDate, setBirthDate] = useState(user.birth_date ?? "");
  const [birthdayVisible, setBirthdayVisible] = useState(
    user.birthday_visible ?? true,
  );
  const [city, setCity] = useState(user.city ?? "");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(
    user.avatar_url ?? null,
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handlePickPhoto = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Photo must be 5 MB or smaller.");
      return;
    }

    setError(null);
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
      if (!putRes.ok) {
        throw new Error("Upload failed — please try again.");
      }
      setAvatarUrl(publicUrl);
    } catch (err: any) {
      setError(err?.message ?? "Photo upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setError(null);
    const dn = displayName.trim();
    if (!dn) {
      setError("Display name is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/social/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: dn,
          username: username.trim().toLowerCase() || undefined,
          bio: bio.trim() ? bio.trim() : null,
          birth_date: birthDate ? birthDate : null,
          birthday_visible: birthdayVisible,
          city: city.trim() ? city.trim() : null,
          avatar_url: avatarUrl,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Save failed");
      }
      const { profile } = await res.json();
      onSaved(profile as Profile);
      // Notify any other consumers of profile state (e.g. the top-nav Header,
      // which tracks user/displayName independently of the Social provider)
      // so they refresh without waiting for the next auth event.
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("melori:profile-updated", { detail: profile }),
        );
      }
      onClose();
    } catch (err: any) {
      setError(err?.message ?? "Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl bg-melori-elevated border border-melori-border p-6 pb-[calc(1.5rem+3.5rem+env(safe-area-inset-bottom))] md:pb-6 shadow-2xl max-h-[calc(100dvh-3.5rem-env(safe-area-inset-bottom)-1rem)] md:max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold">Edit profile</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg hover:bg-white/5 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Avatar */}
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
              className="w-24 h-24 rounded-full object-cover border-2 border-melori-border"
            />
            <span className="absolute inset-0 rounded-full bg-black/50 opacity-0 group-hover:opacity-100 transition flex items-center justify-center">
              <Camera className="w-6 h-6 text-white" />
            </span>
          </button>
          <button
            type="button"
            onClick={handlePickPhoto}
            disabled={uploading}
            className="text-sm text-melori-purple hover:underline disabled:opacity-50"
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

        {/* Fields */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-melori-muted mb-1">
              Display name
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={50}
              className="w-full bg-melori-void/60 border border-melori-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-melori-purple transition"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-melori-muted mb-1">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={30}
              className="w-full bg-melori-void/60 border border-melori-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-melori-purple transition"
              placeholder="unique_handle"
            />
            <p className="mt-1 text-xs text-melori-muted">
              3–30 chars · lowercase letters, numbers, underscore, dot
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-melori-muted mb-1">
              Bio
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={500}
              className="w-full bg-melori-void/60 border border-melori-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-melori-purple transition resize-none"
              placeholder="Say something about yourself…"
            />
            <p className="mt-1 text-xs text-melori-muted text-right">
              {bio.length}/500
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-melori-muted mb-1">
              City
            </label>
            <input
              type="text"
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={120}
              className="w-full bg-melori-void/60 border border-melori-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-melori-purple transition"
              placeholder="Chicago, IL"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-melori-muted mb-1">
              Birthday
            </label>
            <input
              type="date"
              value={birthDate}
              onChange={(e) => setBirthDate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full bg-melori-void/60 border border-melori-border rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-melori-purple transition"
            />
            <label className="mt-2 flex items-center gap-2 text-sm text-melori-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={birthdayVisible}
                onChange={(e) => setBirthdayVisible(e.target.checked)}
                className="h-4 w-4 rounded border-melori-border bg-melori-void/60 accent-melori-purple"
              />
              Show my birthday (month &amp; day) on my profile
            </label>
            <p className="mt-1 text-xs text-melori-muted">
              Your birth year is always private. Uncheck to hide your birthday
              from everyone.
            </p>
          </div>
        </div>

        {error && (
          <p className="mt-4 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
            {error}
          </p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={saving || uploading}
            className="px-5 py-2.5 rounded-full bg-melori-void/60 border border-melori-border text-sm font-medium hover:bg-white/5 transition disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || uploading}
            className="btn-primary px-6 py-2.5 rounded-full font-semibold text-sm disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
