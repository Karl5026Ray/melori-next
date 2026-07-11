"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";
import { Sparkles, Lock, MessageSquare, Tag, Headphones } from "lucide-react";
import CoverImage from "@/components/CoverImage";
import EditProfileModal from "@/components/social/EditProfileModal";
import type { Profile } from "@/types/social";

// /superfan — hub gated to Superfan+ (role in superfan/artist/admin). Free users
// are sent to /membership. Data-driven where tables exist (early-access releases
// feed), cleanly stubbed elsewhere. Never hangs: every state resolves.

type Release = {
  id: string;
  slug?: string | null;
  title?: string | null;
  cover_art_url?: string | null;
  cover_image_url?: string | null;
  release_date?: string | null;
};

const SUPERFAN_TIERS = new Set(["superfan", "artist", "admin"]);

export default function SuperfanPage() {
  const router = useRouter();
  const [state, setState] = useState<"checking" | "ready" | "signed-out">(
    "checking",
  );
  const [releases, setReleases] = useState<Release[]>([]);
  const [hdAudio, setHdAudio] = useState(false);
  // The signed-in user's profile, powering the "Your profile" card + edit modal.
  // Loaded from /api/user/me (the resilient source the gate check already hits).
  const [profile, setProfile] = useState<Profile | null>(null);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setHdAudio(window.localStorage.getItem("melori_hd_audio") === "1");
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) {
        if (active) setState("signed-out");
        router.replace("/social/auth?next=/superfan");
        return;
      }

      const meRes = await authFetch("/api/user/me");
      if (!meRes.ok) {
        router.replace("/social/auth?next=/superfan");
        return;
      }
      const me = (await meRes.json()) as {
        role: string;
        profile?: Record<string, any> | null;
      };
      const role = me.role;
      if (!SUPERFAN_TIERS.has(role)) {
        router.replace("/membership");
        return;
      }
      if (active && me.profile) {
        const p = me.profile;
        setProfile({
          id: p.id ?? session.user.id,
          username: p.username ?? "",
          display_name: p.display_name || p.full_name || p.username || "You",
          avatar_url: p.avatar_url ?? null,
          role: (p.role ?? role) as Profile["role"],
          bio: p.bio ?? null,
          verified: Boolean(p.verified),
          followers_count: p.followers_count ?? 0,
          following_count: p.following_count ?? 0,
        });
      }

      // Early-access feed — most recent published releases. Public endpoint;
      // tolerate either an array or a { releases } envelope.
      try {
        const res = await fetch("/api/releases", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          const list: Release[] = Array.isArray(data)
            ? data
            : data.releases ?? [];
          if (active) setReleases(list.slice(0, 6));
        }
      } catch {
        /* feed stays empty — handled by empty state below */
      }

      if (active) setState("ready");
    })();
    return () => {
      active = false;
    };
  }, [router]);

  const toggleHd = () => {
    const next = !hdAudio;
    setHdAudio(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("melori_hd_audio", next ? "1" : "0");
    }
  };

  if (state !== "ready") {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#c9a96e]/40 border-t-[#c9a96e]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="max-w-4xl mx-auto px-4 py-10">
        <div className="mb-8 flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#c9a96e]/15 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-[#c9a96e]" />
          </div>
          <div>
            <p className="text-xs uppercase tracking-widest text-[#c9a96e]">Superfan</p>
            <h1 className="text-3xl font-bold">Your Superfan hub</h1>
          </div>
        </div>

        {/* Your profile — self-service edit entry point */}
        {profile && (
          <section className="mb-8 rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex flex-col sm:flex-row sm:items-center gap-4">
              <div className="w-16 h-16 shrink-0 overflow-hidden rounded-full border border-[#c9a96e]/30">
                <CoverImage
                  src={profile.avatar_url}
                  alt={profile.display_name}
                  name={profile.display_name}
                  rounded="rounded-full"
                  className="w-full h-full"
                />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold truncate">
                  {profile.display_name}
                </h2>
                <p className="text-xs uppercase tracking-widest text-[#c9a96e] capitalize">
                  {profile.role}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditing(true)}
                  className="px-5 py-2.5 rounded-full bg-[#c9a96e] text-[#0a0a0a] text-sm font-semibold hover:bg-[#d8bd88] transition"
                >
                  Edit profile
                </button>
                <Link
                  href="/settings"
                  className="text-sm text-[#888] hover:text-[#c9a96e] transition"
                >
                  Account settings
                </Link>
              </div>
            </div>
          </section>
        )}

        {/* Early access */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold mb-4">Early access releases</h2>
          {releases.length === 0 ? (
            <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-6 text-sm text-[#888]">
              No early-access drops right now. New releases land here first —
              check back soon.
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {releases.map((r) => {
                const cover = r.cover_art_url || r.cover_image_url || "/favicon.png";
                const href = r.slug ? `/albums/${r.slug}` : "/music";
                return (
                  <Link
                    key={r.id}
                    href={href}
                    className="group rounded-xl overflow-hidden border border-white/10 bg-white/[0.02]"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={cover}
                      alt={r.title ?? "Release"}
                      className="aspect-square w-full object-cover transition group-hover:opacity-90"
                    />
                    <p className="truncate px-3 py-2 text-sm">{r.title ?? "Untitled"}</p>
                  </Link>
                );
              })}
            </div>
          )}
        </section>

        <div className="grid sm:grid-cols-2 gap-4">
          {/* Content locker */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex items-center gap-2 mb-2">
              <Lock className="w-5 h-5 text-[#c9a96e]" />
              <h2 className="text-lg font-semibold">Exclusive locker</h2>
            </div>
            <p className="text-sm text-[#888]">
              Behind-the-scenes clips, demos, and stems from your favorite
              artists. New unlocks are added regularly.
            </p>
          </section>

          {/* Direct messaging */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex items-center gap-2 mb-2">
              <MessageSquare className="w-5 h-5 text-[#c9a96e]" />
              <h2 className="text-lg font-semibold">Message artists</h2>
            </div>
            <p className="text-sm text-[#888] mb-3">
              Reach artists directly in MM Social.
            </p>
            <Link
              href="/social/messages"
              className="inline-block px-5 py-2.5 rounded-full bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition"
            >
              Open messages
            </Link>
          </section>

          {/* Merch discount */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex items-center gap-2 mb-2">
              <Tag className="w-5 h-5 text-[#c9a96e]" />
              <h2 className="text-lg font-semibold">Merch discount</h2>
            </div>
            <p className="text-sm text-[#888] mb-3">
              Use this code at checkout in the store:
            </p>
            <code className="inline-block rounded-lg bg-black/60 border border-white/10 px-3 py-2 text-sm text-[#c9a96e]">
              SUPERFAN10
            </code>
          </section>

          {/* HD audio */}
          <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-6">
            <div className="flex items-center gap-2 mb-2">
              <Headphones className="w-5 h-5 text-[#c9a96e]" />
              <h2 className="text-lg font-semibold">HD audio</h2>
            </div>
            <p className="text-sm text-[#888] mb-3">
              Prefer higher-fidelity streams when available.
            </p>
            <button
              type="button"
              onClick={toggleHd}
              className={`px-5 py-2.5 rounded-full text-sm font-medium transition ${
                hdAudio
                  ? "bg-[#c9a96e] text-[#0a0a0a]"
                  : "bg-white/5 border border-white/10 text-white hover:bg-white/10"
              }`}
            >
              {hdAudio ? "HD audio: On" : "HD audio: Off"}
            </button>
          </section>
        </div>
      </div>

      {editing && profile && (
        <EditProfileModal
          user={profile}
          onClose={() => setEditing(false)}
          onSaved={(updated) => setProfile(updated)}
        />
      )}
    </div>
  );
}
