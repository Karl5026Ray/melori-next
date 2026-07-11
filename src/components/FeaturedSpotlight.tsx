"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import CoverImage from "@/components/CoverImage";
import { supabase } from "@/lib/supabase";
import type { Artist } from "@/types";

// What the spotlight hero needs to render, decoupled from its source (an
// admin-featured Artist row vs. the signed-in user's own artist/profile).
type Spotlight = {
  name: string;
  avatar_url: string | null;
  bio: string | null;
  is_verified: boolean;
  href: string;
};

type MeResponse = {
  artist:
    | {
        name: string;
        slug: string;
        avatar_url: string | null;
        bio: string | null;
        is_verified: boolean;
      }
    | null;
  profile:
    | {
        display_name: string | null;
        full_name: string | null;
        username: string | null;
        avatar_url: string | null;
        bio: string | null;
      }
    | null;
};

function fallbackSpotlight(artist: Artist): Spotlight {
  return {
    name: artist.name,
    avatar_url: artist.avatar_url,
    bio: artist.bio,
    is_verified: artist.is_verified,
    href: `/artists/${artist.slug}`,
  };
}

// The signed-in user's own spotlight links to their social profile.
function mineFromMe(me: MeResponse): Spotlight | null {
  if (me.artist) {
    return {
      name: me.artist.name,
      avatar_url: me.artist.avatar_url,
      bio: me.artist.bio,
      is_verified: me.artist.is_verified,
      href: "/social/profile",
    };
  }
  if (me.profile) {
    const name =
      me.profile.display_name ||
      me.profile.full_name ||
      me.profile.username ||
      null;
    if (!name) return null;
    return {
      name,
      avatar_url: me.profile.avatar_url,
      bio: me.profile.bio,
      is_verified: false,
      href: "/social/profile",
    };
  }
  return null;
}

// Renders the Featured Artist spotlight. When a user is signed in and has a
// resolvable artist/profile, the hero shows THEIR profile (View profile →
// /social/profile). Otherwise it shows the admin-featured `fallback`.
export default function FeaturedSpotlight({ fallback }: { fallback: Artist }) {
  const [mine, setMine] = useState<Spotlight | null>(null);

  useEffect(() => {
    let active = true;

    async function resolve() {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        if (active) setMine(null);
        return;
      }
      try {
        const res = await fetch("/api/artist/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          if (active) setMine(null);
          return;
        }
        const me = (await res.json()) as MeResponse;
        if (active) setMine(mineFromMe(me));
      } catch {
        if (active) setMine(null);
      }
    }

    void resolve();
    const { data: sub } = supabase.auth.onAuthStateChange(() => {
      void resolve();
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const spotlight = mine ?? fallbackSpotlight(fallback);

  return (
    <Link
      href={spotlight.href}
      className="group block overflow-hidden rounded-2xl border border-brand-border bg-brand-surface transition-colors hover:border-brand-primary"
    >
      <div className="flex flex-col items-center gap-6 p-8 text-center sm:flex-row sm:text-left">
        <CoverImage
          src={spotlight.avatar_url}
          alt={spotlight.name}
          className="h-40 w-40 shrink-0"
          rounded="rounded-full"
        />
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-primary">
            Spotlight
          </p>
          <h2 className="mt-1 flex items-center justify-center gap-2 text-2xl font-bold text-text-primary group-hover:text-brand-primary sm:justify-start">
            <span className="truncate">{spotlight.name}</span>
            {spotlight.is_verified && (
              <span
                className="text-brand-primary"
                aria-label="Verified"
                title="Verified"
              >
                ✓
              </span>
            )}
          </h2>
          {spotlight.bio && (
            <p className="mt-3 max-w-2xl text-sm leading-relaxed text-text-secondary">
              {spotlight.bio}
            </p>
          )}
          <span className="mt-4 inline-block rounded-full bg-brand-primary px-5 py-2 text-sm font-semibold text-white transition-colors group-hover:bg-brand-primary-dark">
            View profile
          </span>
        </div>
      </div>
    </Link>
  );
}
