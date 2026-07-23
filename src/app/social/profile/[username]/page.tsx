"use client";

// Public member profile — view ANY member by username and follow/unfollow
// them. The self-profile stays at /social/profile (editable); this route is
// the read + follow view of everyone else. If a viewer lands on their own
// username, we point them at the editable self page.

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { authFetch } from "@/lib/authClient";
import FollowButton from "@/components/social/FollowButton";
import { MemberActions } from "@/components/social/MemberActions";
import ProfileTabs from "@/components/social/profile/ProfileTabs";
import ProfileContentModal from "@/components/social/profile/ProfileContentModal";
import type { TileContent } from "@/components/social/profile/ProfileContentTile";
import { Loader2 } from "lucide-react";

type PublicProfile = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  bio: string | null;
  verified: boolean;
  followers_count: number;
  following_count: number;
};

type ViewerState = {
  isSelf: boolean;
  following: boolean;
  blocked: boolean;
  signedIn: boolean;
};

export default function PublicProfilePage() {
  // On Next.js 14 the client-component route param is read via the
  // useParams() hook (NOT React.use(params), which is a Next 15 convention
  // and throws React error #438 here because params is a plain object).
  const params = useParams<{ username: string }>();
  const username = params.username;
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [openItem, setOpenItem] = useState<{
    type: "video" | "photo";
    content: TileContent;
  } | null>(null);
  const [viewer, setViewer] = useState<ViewerState | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setNotFound(false);
    (async () => {
      try {
        const res = await authFetch(
          `/api/social/profile/${encodeURIComponent(username)}`,
        );
        if (!active) return;
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        const data = (await res.json()) as {
          profile: PublicProfile;
          viewer: ViewerState;
        };
        setProfile(data.profile);
        setViewer(data.viewer);
      } catch {
        if (active) setNotFound(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [username]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-melori-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  if (notFound || !profile) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Member not found</h1>
        <p className="mt-2 text-melori-muted">
          We couldn&apos;t find a member with that username.
        </p>
        <Link
          href="/social"
          className="mt-6 inline-block rounded-full bg-melori-purple px-6 py-2.5 text-sm font-medium text-white hover:bg-melori-purple/90"
        >
          Browse members
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-8 flex items-start gap-4">
        <div className="shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={profile.avatar_url || "/favicon.png"}
            className="h-32 w-32 rounded-full border-4 border-melori-void object-cover"
            alt={profile.display_name}
          />
        </div>
        <div className="mb-2 min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <h2 className="text-2xl font-bold">{profile.display_name}</h2>
            {profile.verified && (
              <span className="rounded-full bg-melori-purple/10 px-2 py-0.5 text-xs font-medium text-melori-purple">
                Verified
              </span>
            )}
          </div>
          <p className="mb-1.5 text-sm text-melori-muted">@{profile.username}</p>
          <p className="mb-2 text-sm font-medium capitalize text-melori-purple">
            {profile.role}
          </p>
          <p className="text-sm leading-relaxed text-melori-muted break-words">
            {profile.bio || "Independent music advocate"}
          </p>
        </div>

        {/* Action: edit if it's you, follow/unfollow otherwise. Hidden when
           signed out or when a block exists in either direction. */}
        <div className="flex gap-2">
          {viewer?.isSelf ? (
            <Link
              href="/social/profile"
              className="rounded-full border border-melori-border bg-melori-elevated px-6 py-2.5 text-sm font-medium transition hover:border-melori-purple/30 hover:bg-melori-purple/10"
            >
              Edit Profile
            </Link>
          ) : viewer?.signedIn && !viewer?.blocked ? (
            <>
              <FollowButton
                targetId={profile.id}
                initialFollowing={viewer.following}
                onChange={(_f, counts) => {
                  if (counts) {
                    setProfile((p) =>
                      p ? { ...p, followers_count: counts.followers_count } : p,
                    );
                  }
                }}
              />
              {/* Message / block — ties Messages to the profile. */}
              <MemberActions
                memberId={profile.id}
                memberName={profile.display_name}
                initiallyBlocked={viewer.blocked}
              />
            </>
          ) : !viewer?.signedIn ? (
            <Link
              href="/social/auth"
              className="rounded-full bg-melori-purple px-6 py-2.5 text-sm font-medium text-white hover:bg-melori-purple/90"
            >
              Sign in to follow
            </Link>
          ) : null}
        </div>
      </div>

      <div className="mb-8 flex gap-6 text-sm">
        <div>
          <span className="font-bold text-melori-text">
            {profile.followers_count}
          </span>{" "}
          <span className="text-melori-muted">Followers</span>
        </div>
        <div>
          <span className="font-bold text-melori-text">
            {profile.following_count}
          </span>{" "}
          <span className="text-melori-muted">Following</span>
        </div>
      </div>

      {/* Public tab bar: owner-only tabs (Liked/Saves/Family/Settings) are
          hidden automatically by the tabs endpoint's isOwner flag. */}
      <ProfileTabs
        userId={profile.id}
        isOwner={!!viewer?.isSelf}
        onOpenContent={(content, type) => setOpenItem({ type, content })}
      />

      {openItem && (
        <ProfileContentModal
          type={openItem.type}
          content={openItem.content}
          onClose={() => setOpenItem(null)}
        />
      )}
    </div>
  );
}
