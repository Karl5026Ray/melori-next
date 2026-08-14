"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Clapperboard, Mic2, Radio, UserRound, Video } from "lucide-react";
import CoverImage from "@/components/CoverImage";
import { authFetch } from "@/lib/authClient";
import {
  getLiveRoomPresentation,
  ONLINE_PRESENCE_PRESENTATION,
  type LivePresenceTone,
} from "@/lib/roomStatus";

// A live room, as returned by GET /api/mirror/live. Mirrors the select in that
// route. Only the fields the ring row needs are typed here.
export type MirrorLiveRoom = {
  id: string;
  title: string | null;
  topic: string | null;
  room_format: string | null;
  livekit_room: string | null;
  participant_count: number | null;
  host: {
    id: string;
    display_name: string | null;
    username: string | null;
    avatar_url: string | null;
    verified: boolean | null;
    role: string | null;
  } | null;
};

// An online member (not hosting a live room), as returned by GET /api/mirror/live.
export type MirrorOnlineMember = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  verified: boolean | null;
  role: string | null;
};

function memberName(m: MirrorOnlineMember) {
  return m.display_name || m.username || "Member";
}

const TONE_CLASSES: Record<
  LivePresenceTone,
  { ring: string; badge: string }
> = {
  orange: { ring: "bg-brand-primary", badge: "bg-brand-primary" },
  teal: { ring: "bg-melori-teal", badge: "bg-melori-teal" },
  purple: { ring: "bg-melori-purple", badge: "bg-melori-purple" },
  gold: { ring: "bg-cinema-gold", badge: "bg-cinema-gold text-black" },
};

const STATUS_ICONS = {
  video: Video,
  mic: Mic2,
  radio: Radio,
  clapperboard: Clapperboard,
} as const;

// The horizontal "online now" ring row — Instagram-Stories-style circles of
// who is on Melori right now.
//
// It shows two things:
//   - LIVE rooms (spaces where status='live'): a gradient "live" ring; tapping
//     it deep-links straight into that room. Discovery-oriented.
//   - ONLINE members (signed-in and recently active via the presence heartbeat,
//     but not hosting a room): a subtler ring linking to their profile. This
//     is the "user pill lights up when a friend signs on" surface.
//
// `showLiveRooms` toggles the first section. Default true preserves the
// original discovery-first layout for any Mirror-style placement; the Messages
// page passes false so the strip is pure user pills, framed as "find your
// people" rather than "find something to join."
//
// `friendsOnly` restricts the user pills to the caller's MUTUAL follows — the
// people the caller both follows and is followed by. Fires the API with
// scope=friends; anonymous callers get nobody back and see the empty state.
//
// Data source is /api/mirror/live; we poll it on a light interval so the row
// tracks who's around without a reload, and we send our own presence heartbeat
// so this viewer shows up in everyone else's row too. When nobody is around we
// show a subtle "be the first" prompt rather than hiding the row.
export default function OnlineNowRow({
  showLiveRooms = true,
  friendsOnly = false,
}: {
  showLiveRooms?: boolean;
  friendsOnly?: boolean;
} = {}) {
  const [rooms, setRooms] = useState<MirrorLiveRoom[]>([]);
  const [members, setMembers] = useState<MirrorOnlineMember[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const url = friendsOnly
          ? "/api/mirror/live?scope=friends"
          : "/api/mirror/live";
        const res = await authFetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const data: {
          live?: MirrorLiveRoom[];
          members?: MirrorOnlineMember[];
        } = await res.json();
        if (active) {
          setRooms(data.live ?? []);
          setMembers(data.members ?? []);
        }
      } catch {
        /* transient — keep whatever we already have */
      } finally {
        if (active) setLoaded(true);
      }
    }

    load();
    // Refresh every 20s so the ring row tracks who's around without a reload.
    const t = setInterval(load, 20_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, [friendsOnly]);

  const visibleRooms = showLiveRooms ? rooms : [];
  const isEmpty = visibleRooms.length === 0 && members.length === 0;

  return (
    <div className="w-full border-b border-white/10 bg-melori-void/80 px-4 py-4 backdrop-blur">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-white">
          Online now
        </h2>
        <Link
          href="/social/live"
          className="text-xs font-semibold text-melori-muted transition-colors hover:text-brand-primary"
        >
          Go live
        </Link>
      </div>

      <div
        className="flex gap-4 overflow-x-auto pb-1"
        style={{ overscrollBehaviorX: "contain", touchAction: "pan-x" }}
      >
        {isEmpty ? (
          // Empty state — nobody live or online. Invite the viewer to be first.
          <Link
            href="/social/live"
            className="flex shrink-0 flex-col items-center gap-2"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-white/25 text-2xl text-melori-muted transition-colors hover:border-brand-primary hover:text-brand-primary">
              +
            </div>
            <span className="max-w-[4.5rem] truncate text-center text-xs text-melori-muted">
              {loaded ? "Be the first" : "Loading…"}
            </span>
          </Link>
        ) : (
          <>
            {visibleRooms.map((room) => {
              const name =
                room.host?.display_name ||
                room.host?.username ||
                "Live";
              const status = getLiveRoomPresentation({
                ...room,
                status: "live",
              });
              if (!status) return null;
              const tone = TONE_CLASSES[status.tone];
              const StatusIcon = STATUS_ICONS[status.icon];
              return (
                <Link
                  key={`room-${room.id}`}
                  href={status.href}
                  className="group flex shrink-0 flex-col items-center gap-2"
                  title={room.title ?? name}
                  aria-label={`Join ${room.title ?? name}. ${status.ariaLabel}, hosted by ${name}`}
                  data-testid={`mirror-presence-${status.kind}-${room.id}`}
                >
                  <span className={`relative rounded-full p-[3px] ${tone.ring}`}>
                    <span className="block rounded-full bg-melori-void p-[2px]">
                      <CoverImage
                        src={room.host?.avatar_url ?? null}
                        alt={name}
                        name={name}
                        className="h-14 w-14"
                        rounded="rounded-full"
                      />
                    </span>
                    <span
                      className={`absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-white shadow ${tone.badge}`}
                    >
                      <StatusIcon className="h-2.5 w-2.5" aria-hidden="true" />
                      {status.label}
                    </span>
                  </span>
                  <span className="max-w-[4.5rem] truncate pt-0.5 text-center text-xs text-white">
                    {name}
                  </span>
                </Link>
              );
            })}

            {members.map((member) => {
              const name = memberName(member);
              const href = member.username
                ? `/social/profile/${member.username}`
                : "/social/mirror";
              return (
                <Link
                  key={`member-${member.id}`}
                  href={href}
                  className="group flex shrink-0 flex-col items-center gap-2"
                  title={name}
                  aria-label={`Open ${name}'s profile. ${ONLINE_PRESENCE_PRESENTATION.ariaLabel}`}
                  data-testid={`mirror-presence-online-${member.id}`}
                >
                  <span className="relative rounded-full bg-white/25 p-[3px]">
                    <span className="block rounded-full bg-melori-void p-[2px]">
                      <CoverImage
                        src={member.avatar_url ?? null}
                        alt={name}
                        name={name}
                        className="h-14 w-14"
                        rounded="rounded-full"
                      />
                    </span>
                    <span className="absolute -bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-0.5 rounded-full bg-melori-elevated px-1.5 py-0.5 text-[9px] font-bold uppercase leading-none text-white shadow">
                      <UserRound className="h-2.5 w-2.5" aria-hidden="true" />
                      {ONLINE_PRESENCE_PRESENTATION.label}
                    </span>
                    <span
                      className="absolute right-0 top-0 h-3 w-3 rounded-full border-2 border-melori-void bg-emerald-400"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="max-w-[4.5rem] truncate pt-0.5 text-center text-xs text-melori-muted">
                    {name}
                  </span>
                </Link>
              );
            })}
          </>
        )}
      </div>
    </div>
  );
}
