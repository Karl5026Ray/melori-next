"use client";

// Reusable Follow / Unfollow (a.k.a. "friend/unfriend") button.
//
// One-directional model like most platforms: tap to follow instantly, tap
// again to unfollow. Optimistic UI with rollback on error. Hidden entirely
// when the target is yourself, you're signed out, or a block exists — the
// parent decides those via props so this component stays dumb + reusable.

import { useState } from "react";
import { authFetch } from "@/lib/authClient";

type Props = {
  /** The user id of the member to follow/unfollow. */
  targetId: string;
  /** Whether the current viewer already follows this member. */
  initialFollowing: boolean;
  /** Optional: notify parent so follower counts can update live. */
  onChange?: (following: boolean, counts?: { followers_count: number; following_count: number }) => void;
  className?: string;
};

export default function FollowButton({
  targetId,
  initialFollowing,
  onChange,
  className = "",
}: Props) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    if (busy) return;
    const next = !following;
    setBusy(true);
    setError(null);
    // Optimistic flip.
    setFollowing(next);

    try {
      const res = next
        ? await authFetch("/api/social/follow", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ target: targetId }),
          })
        : await authFetch(
            `/api/social/follow?target=${encodeURIComponent(targetId)}`,
            { method: "DELETE" },
          );

      if (!res.ok) {
        const { error: msg } = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(msg || "Something went wrong");
      }

      const data = (await res.json()) as {
        following: boolean;
        followers_count: number;
        following_count: number;
      };
      setFollowing(data.following);
      onChange?.(data.following, {
        followers_count: data.followers_count,
        following_count: data.following_count,
      });
    } catch (e) {
      // Roll back the optimistic flip.
      setFollowing(!next);
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={following}
        className={
          className ||
          `px-6 py-2.5 rounded-full font-medium text-sm transition disabled:opacity-60 ${
            following
              ? "bg-melori-elevated border border-melori-border text-melori-text hover:border-melori-danger/40 hover:text-melori-danger"
              : "bg-melori-purple text-white hover:bg-melori-purple/90"
          }`
        }
      >
        {busy ? "…" : following ? "Following" : "Follow"}
      </button>
      {error && <span className="text-xs text-melori-danger">{error}</span>}
    </div>
  );
}
