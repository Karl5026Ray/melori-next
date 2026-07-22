"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Film,
  Image as ImageIcon,
  Heart,
  Share2,
  Bookmark,
  Users,
  Home,
  Cake,
  Settings as SettingsIcon,
  Loader2,
} from "lucide-react";
import { authFetch } from "@/lib/authClient";
import ProfileContentTile, { TileContent } from "./ProfileContentTile";

// The full profile experience: a sticky tab bar (Instagram/Facebook style) with
// content that swaps in place. Public tabs work for any profile; private tabs
// (Liked / Saves / Family / Settings) only render for the owner.

export type TabKey =
  | "reels"
  | "photos"
  | "liked"
  | "shared"
  | "saves"
  | "friends"
  | "family"
  | "birthday"
  | "settings";

type Counts = Partial<Record<TabKey, number>>;

type TabsData = {
  isOwner: boolean;
  profile: { id: string; display_name: string; city: string | null };
  birthday: { month: number; day: number; year?: number } | null;
  reels: TileContent[];
  photos: TileContent[];
  reshares: { id: string; target_type: "video" | "photo"; caption: string | null; content: TileContent }[];
  counts: Counts;
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const TAB_META: {
  key: TabKey;
  label: string;
  icon: typeof Film;
  ownerOnly?: boolean;
}[] = [
  { key: "reels", label: "Reels", icon: Film },
  { key: "photos", label: "Photos", icon: ImageIcon },
  { key: "liked", label: "Liked", icon: Heart, ownerOnly: true },
  { key: "shared", label: "Shared", icon: Share2 },
  { key: "saves", label: "Saves", icon: Bookmark, ownerOnly: true },
  { key: "friends", label: "Friends", icon: Users },
  { key: "family", label: "Family", icon: Home, ownerOnly: true },
  { key: "birthday", label: "Birthday", icon: Cake },
  { key: "settings", label: "Settings", icon: SettingsIcon, ownerOnly: true },
];

export default function ProfileTabs({
  userId,
  isOwner: isOwnerHint,
  onEditProfile,
  onOpenContent,
}: {
  userId: string;
  isOwner: boolean;
  onEditProfile?: () => void;
  onOpenContent?: (content: TileContent, type: "video" | "photo") => void;
}) {
  const [active, setActive] = useState<TabKey>("reels");
  const [data, setData] = useState<TabsData | null>(null);
  const [loading, setLoading] = useState(true);

  // Base aggregate (profile content + counts).
  useEffect(() => {
    let alive = true;
    setLoading(true);
    (async () => {
      try {
        const res = await authFetch(
          `/api/social/profile/tabs?user_id=${encodeURIComponent(userId)}`,
        );
        if (!res.ok) return;
        const json = (await res.json()) as TabsData;
        if (alive) setData(json);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [userId]);

  const isOwner = data?.isOwner ?? isOwnerHint;
  const tabs = TAB_META.filter((t) => !t.ownerOnly || isOwner);
  const counts = data?.counts ?? {};

  return (
    <div>
      {/* Sticky tab bar */}
      <div className="sticky top-0 z-20 -mx-4 mb-6 border-b border-melori-border bg-melori-void/90 px-4 backdrop-blur md:-mx-8 md:px-8">
        <div className="flex gap-1 overflow-x-auto no-scrollbar">
          {tabs.map((t) => {
            const Icon = t.icon;
            const isActive = active === t.key;
            const count = counts[t.key];
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setActive(t.key)}
                className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-melori-purple text-melori-text"
                    : "border-transparent text-melori-muted hover:text-melori-text"
                }`}
              >
                <Icon className="h-4 w-4" />
                <span>{t.label}</span>
                {typeof count === "number" && count > 0 && (
                  <span className="rounded-full bg-melori-elevated px-1.5 text-xs text-melori-muted">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab body */}
      <div className="min-h-[240px]">
        {loading && !data ? (
          <div className="flex justify-center py-16 text-melori-muted">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <TabBody
            active={active}
            data={data}
            isOwner={isOwner}
            userId={userId}
            onEditProfile={onEditProfile}
            onOpenContent={onOpenContent}
          />
        )}
      </div>
    </div>
  );
}

function TabBody({
  active,
  data,
  isOwner,
  userId,
  onEditProfile,
  onOpenContent,
}: {
  active: TabKey;
  data: TabsData | null;
  isOwner: boolean;
  userId: string;
  onEditProfile?: () => void;
  onOpenContent?: (content: TileContent, type: "video" | "photo") => void;
}) {
  if (!data) return null;

  switch (active) {
    case "reels":
      return (
        <Grid
          empty="No live reels right now. Post one on Melori Mirror — it shows up here."
          tiles={data.reels.map((c) => ({ type: "video" as const, content: c }))}
          onOpen={onOpenContent}
        />
      );
    case "photos":
      return (
        <Grid
          empty="No photos yet."
          tiles={data.photos.map((c) => ({
            type: (c.media_type === "video" ? "video" : "photo") as
              | "video"
              | "photo",
            content: c,
          }))}
          onOpen={onOpenContent}
        />
      );
    case "shared":
      return (
        <Grid
          empty="Nothing shared yet."
          tiles={data.reshares.map((r) => ({
            type: r.target_type,
            content: r.content,
          }))}
          onOpen={onOpenContent}
        />
      );
    case "liked":
      return <LazyGrid endpoint="/api/social/liked" onOpen={onOpenContent} empty="No liked posts yet." />;
    case "saves":
      return <LazyGrid endpoint="/api/social/saves" onOpen={onOpenContent} empty="No saved posts yet." />;
    case "friends":
      return <ConnectionsList kind="friends" empty="No friends yet. Friends are people you and they both follow." />;
    case "family":
      return (
        <ConnectionsList
          kind="family"
          empty="No family added yet. Open Friends and tap the family badge to add someone."
        />
      );
    case "birthday":
      return <BirthdayPanel data={data} isOwner={isOwner} onEditProfile={onEditProfile} />;
    case "settings":
      return <SettingsPanel onEditProfile={onEditProfile} />;
    default:
      return null;
  }
}

// ---- Grids -----------------------------------------------------------------

function Grid({
  tiles,
  empty,
  onOpen,
}: {
  tiles: { type: "video" | "photo"; content: TileContent }[];
  empty: string;
  onOpen?: (content: TileContent, type: "video" | "photo") => void;
}) {
  if (tiles.length === 0) {
    return <EmptyState text={empty} />;
  }
  return (
    <div className="grid grid-cols-3 gap-2 sm:gap-3">
      {tiles.map((t, i) => (
        <ProfileContentTile
          key={`${t.content.id}-${i}`}
          type={t.type}
          content={t.content}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

// A grid that fetches { items: [{ target_type, content }] } on mount.
function LazyGrid({
  endpoint,
  empty,
  onOpen,
}: {
  endpoint: string;
  empty: string;
  onOpen?: (content: TileContent, type: "video" | "photo") => void;
}) {
  const [tiles, setTiles] = useState<
    { type: "video" | "photo"; content: TileContent }[] | null
  >(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await authFetch(endpoint);
        if (!res.ok) {
          if (alive) setTiles([]);
          return;
        }
        const json = await res.json();
        const items = (json.items ?? []).map((it: any) => ({
          type: it.target_type as "video" | "photo",
          content: it.content as TileContent,
        }));
        if (alive) setTiles(items);
      } catch {
        if (alive) setTiles([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [endpoint]);

  if (tiles === null) {
    return (
      <div className="flex justify-center py-16 text-melori-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  return <Grid tiles={tiles} empty={empty} onOpen={onOpen} />;
}

// ---- Connections (Friends / Family) ----------------------------------------

type Connection = {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
  role: string;
  verified: boolean;
  isFamily: boolean;
  isFriend: boolean;
};

function ConnectionsList({
  kind,
  empty,
}: {
  kind: "friends" | "family";
  empty: string;
}) {
  const [items, setItems] = useState<Connection[] | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await authFetch(`/api/social/connections?kind=${kind}`);
      if (!res.ok) {
        setItems([]);
        return;
      }
      const json = await res.json();
      setItems(json.items ?? []);
    } catch {
      setItems([]);
    }
  }, [kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFamily = async (contactId: string, makeFamily: boolean) => {
    // Optimistic update.
    setItems((prev) =>
      prev
        ? prev.map((c) =>
            c.id === contactId ? { ...c, isFamily: makeFamily } : c,
          )
        : prev,
    );
    try {
      await authFetch("/api/social/connections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact_id: contactId, family: makeFamily }),
      });
      if (kind === "family") void load(); // removed rows should drop out
    } catch {
      void load(); // reconcile on error
    }
  };

  if (items === null) {
    return (
      <div className="flex justify-center py-16 text-melori-muted">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (items.length === 0) return <EmptyState text={empty} />;

  return (
    <ul className="divide-y divide-melori-border">
      {items.map((c) => (
        <li key={c.id} className="flex items-center gap-3 py-3">
          <Link
            href={`/social/profile/${c.username}`}
            className="flex flex-1 items-center gap-3"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={c.avatar_url || "/favicon.png"}
              alt=""
              className="h-11 w-11 rounded-full object-cover"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-melori-text">
                {c.display_name}
              </p>
              <p className="truncate text-xs text-melori-muted">
                @{c.username}
              </p>
            </div>
          </Link>
          <button
            type="button"
            onClick={() => toggleFamily(c.id, !c.isFamily)}
            className={`flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
              c.isFamily
                ? "border-melori-purple/40 bg-melori-purple/10 text-melori-purple"
                : "border-melori-border text-melori-muted hover:text-melori-text"
            }`}
          >
            <Home className="h-3.5 w-3.5" />
            {c.isFamily ? "Family" : "Add to family"}
          </button>
        </li>
      ))}
    </ul>
  );
}

// ---- Birthday --------------------------------------------------------------

function BirthdayPanel({
  data,
  isOwner,
  onEditProfile,
}: {
  data: TabsData;
  isOwner: boolean;
  onEditProfile?: () => void;
}) {
  const b = data.birthday;
  if (!b) {
    return (
      <div className="glass rounded-2xl p-8 text-center">
        <Cake className="mx-auto mb-3 h-10 w-10 text-melori-muted opacity-40" />
        <p className="text-melori-muted">
          {isOwner
            ? "You haven't added a birthday, or it's hidden."
            : "This member hasn't shared a birthday."}
        </p>
        {isOwner && onEditProfile && (
          <button
            type="button"
            onClick={onEditProfile}
            className="mt-4 rounded-full bg-melori-elevated border border-melori-border px-5 py-2 text-sm font-medium hover:border-melori-purple/40"
          >
            Add birthday
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="glass rounded-2xl p-8 text-center">
      <Cake className="mx-auto mb-3 h-10 w-10 text-melori-purple" />
      <p className="text-lg font-semibold text-melori-text">
        {MONTHS[b.month - 1]} {b.day}
        {isOwner && b.year ? `, ${b.year}` : ""}
      </p>
      {isOwner && (
        <p className="mt-1 text-xs text-melori-muted">
          Your birth year is private. Change visibility in Edit profile.
        </p>
      )}
    </div>
  );
}

// ---- Settings (inline) -----------------------------------------------------

function SettingsPanel({ onEditProfile }: { onEditProfile?: () => void }) {
  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onEditProfile}
        className="flex w-full items-center justify-between rounded-2xl border border-melori-border bg-melori-elevated px-5 py-4 text-left transition hover:border-melori-purple/40"
      >
        <span>
          <span className="block text-sm font-semibold text-melori-text">
            Edit profile
          </span>
          <span className="block text-xs text-melori-muted">
            Name, photo, bio, city, birthday &amp; privacy
          </span>
        </span>
        <SettingsIcon className="h-5 w-5 text-melori-muted" />
      </button>

      <Link
        href="/social/blocked"
        className="flex w-full items-center justify-between rounded-2xl border border-melori-border bg-melori-elevated px-5 py-4 text-left transition hover:border-melori-purple/40"
      >
        <span>
          <span className="block text-sm font-semibold text-melori-text">
            Blocked members
          </span>
          <span className="block text-xs text-melori-muted">
            Review and unblock people you&apos;ve blocked
          </span>
        </span>
        <span className="text-melori-muted">›</span>
      </Link>

      <Link
        href="/settings"
        className="flex w-full items-center justify-between rounded-2xl border border-melori-border bg-melori-elevated px-5 py-4 text-left transition hover:border-melori-purple/40"
      >
        <span>
          <span className="block text-sm font-semibold text-melori-text">
            Account &amp; notifications
          </span>
          <span className="block text-xs text-melori-muted">
            Membership, email preferences, sign out
          </span>
        </span>
        <span className="text-melori-muted">›</span>
      </Link>
    </div>
  );
}

// ---- Shared ----------------------------------------------------------------

function EmptyState({ text }: { text: string }) {
  return (
    <div className="py-16 text-center text-melori-muted">
      <p className="mx-auto max-w-xs text-sm">{text}</p>
    </div>
  );
}
