"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { Radio, Camera, Loader2 } from "lucide-react";
import EditProfileModal from "@/components/social/EditProfileModal";
import ProfileGallery from "@/components/ProfileGallery";
import { authFetch } from "@/lib/authClient";

export default function ProfilePage() {
  const { user, applyUser, refreshUser } = useAuth();
  const [editing, setEditing] = useState(false);
  const [bannerUrl, setBannerUrl] = useState<string | null>(null);
  const [uploadingBanner, setUploadingBanner] = useState(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const bannerInputRef = useRef<HTMLInputElement>(null);

  // Every signed-in user (free/superfan/artist) has a banner stored on their
  // profile row. Fetch it from the universal profile-media endpoint.
  useEffect(() => {
    let active = true;
    if (!user) return;
    (async () => {
      try {
        const res = await authFetch("/api/artist/profile-media");
        if (!res.ok) return;
        const { media } = (await res.json()) as {
          media: { banner_url: string | null } | null;
        };
        if (active) setBannerUrl(media?.banner_url ?? null);
      } catch {
        /* ignore — placeholder stays */
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  // Upload flow: POST for a signed URL → PUT the file to storage → PATCH the
  // returned public URL onto the profile. Any signed-in user may do this.
  const onBannerFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setBannerError("Please choose an image file.");
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setBannerError("Banner must be under 8MB.");
      return;
    }
    setBannerError(null);
    setUploadingBanner(true);
    try {
      const signRes = await authFetch("/api/artist/profile-media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, slot: "cover" }),
      });
      if (!signRes.ok) throw new Error("Could not start upload");
      const { signedUrl, publicUrl } = (await signRes.json()) as {
        signedUrl: string;
        publicUrl: string;
      };

      const putRes = await fetch(signedUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) throw new Error("Upload failed");

      const saveRes = await authFetch("/api/artist/profile-media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicUrl, slot: "cover" }),
      });
      if (!saveRes.ok) throw new Error("Could not save banner");
      // Cache-bust so the new image shows immediately.
      setBannerUrl(`${publicUrl}?t=${Date.now()}`);
    } catch (err) {
      setBannerError(
        err instanceof Error ? err.message : "Something went wrong.",
      );
    } finally {
      setUploadingBanner(false);
    }
  };

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-melori-muted">Sign in to view your profile</p>
      </div>
    );
  }

  const view = user;

  return (
    <div className="flex-1 overflow-y-auto animate-fade-in">
      <div className="relative h-40 sm:h-56 md:h-64 bg-gradient-to-br from-brand-primary/25 to-brand-accent/20">
        {bannerUrl && (
          <img
            src={bannerUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-melori-void to-transparent" />

        {/* Edit-banner control — available to every signed-in user. */}
        <input
          ref={bannerInputRef}
          type="file"
          accept="image/*"
          onChange={onBannerFile}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => bannerInputRef.current?.click()}
          disabled={uploadingBanner}
          className="absolute right-3 top-3 z-10 flex items-center gap-2 rounded-full bg-black/55 px-3 py-2 text-xs font-semibold text-white backdrop-blur transition-colors hover:bg-black/70 disabled:opacity-60"
        >
          {uploadingBanner ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <Camera className="h-4 w-4" />
              {bannerUrl ? "Change banner" : "Add banner"}
            </>
          )}
        </button>
        {bannerError && (
          <p className="absolute bottom-2 right-3 z-10 rounded-md bg-red-600/90 px-2 py-1 text-xs text-white">
            {bannerError}
          </p>
        )}
      </div>

      <div className="max-w-3xl mx-auto px-4 md:px-8 -mt-16 relative z-10 pb-28 md:pb-8">
        <div className="flex flex-col md:flex-row items-start md:items-end gap-4 mb-6">
          <div className="relative">
            <img
              src={view.avatar_url || "/favicon.png"}
              className="w-32 h-32 rounded-full border-4 border-melori-void object-cover"
              alt={view.display_name}
            />
          </div>
          <div className="flex-1 mb-2">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-2xl font-bold">{view.display_name}</h2>
              {view.verified && (
                <span className="text-melori-purple bg-melori-purple/10 px-2 py-0.5 rounded-full text-xs font-medium">
                  Verified
                </span>
              )}
            </div>
            <p className="text-melori-purple font-medium text-sm mb-1 capitalize">
              {view.role}
            </p>
            <p className="text-melori-muted text-sm">
              {view.bio || "Independent music advocate"}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-6 py-2.5 rounded-full bg-melori-elevated border border-melori-border font-medium text-sm hover:bg-melori-purple/10 hover:border-melori-purple/30 transition"
            >
              Edit Profile
            </button>
          </div>
        </div>

        <div className="flex gap-6 mb-8 text-sm">
          <div>
            <span className="font-bold text-melori-text">
              {view.followers_count}
            </span>{" "}
            <span className="text-melori-muted">Followers</span>
          </div>
          <div>
            <span className="font-bold text-melori-text">
              {view.following_count}
            </span>{" "}
            <span className="text-melori-muted">Following</span>
          </div>
        </div>

        <div className="glass rounded-2xl p-6 mb-6">
          <h3 className="font-bold mb-4">Stats</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="text-center p-4 bg-melori-void/50 rounded-xl">
              <p className="text-2xl font-bold gradient-text">0</p>
              <p className="text-xs text-melori-muted mt-1">Spaces Hosted</p>
            </div>
            <div className="text-center p-4 bg-melori-void/50 rounded-xl">
              <p className="text-2xl font-bold gradient-text">0</p>
              <p className="text-xs text-melori-muted mt-1">Spaces Joined</p>
            </div>
            <div className="text-center p-4 bg-melori-void/50 rounded-xl">
              <p className="text-2xl font-bold gradient-text">0</p>
              <p className="text-xs text-melori-muted mt-1">Messages</p>
            </div>
            <div className="text-center p-4 bg-melori-void/50 rounded-xl">
              <p className="text-2xl font-bold gradient-text">0</p>
              <p className="text-xs text-melori-muted mt-1">Videos</p>
            </div>
          </div>
        </div>

        <ProfileGallery profileId={view.id} className="mb-6" />

        <div className="glass rounded-2xl p-6">
          <h3 className="font-bold mb-4">Recent Activity</h3>
          <div className="text-center py-12 text-melori-muted">
            <Radio className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p>No activity yet. Start exploring Spaces!</p>
          </div>
        </div>
      </div>

      {editing && (
        <EditProfileModal
          user={view}
          onClose={() => setEditing(false)}
          onSaved={(updated) => {
            // Instantly reflect the new fields everywhere (Header, sidebars,
            // this page) and then re-fetch to pick up anything the server
            // normalized (e.g. lowercased username, computed fields).
            applyUser(updated);
            void refreshUser();
          }}
        />
      )}
    </div>
  );
}
