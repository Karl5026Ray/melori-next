"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import CoverImage from "@/components/CoverImage";
import { authFetch } from "@/lib/authClient";

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

// Video room formats deep-link into MM Faces; everything else is an audio Space.
const VIDEO_FORMATS = new Set(["live_solo", "live_duo", "live_group"]);

function roomHref(room: MirrorLiveRoom) {
  return VIDEO_FORMATS.has(room.room_format ?? "")
    ? `/social/live/${room.id}`
    : `/social/spaces/${room.id}`;
}

function memberName(m: MirrorOnlineMember) {
  return m.display_name || m.username || "Member";
}

// The horizontal "online now" ring row that sits at the very top of Melori
// Mirror — Instagram-Stories-style circles of who is on Melori right now.
//
// It shows two things, live rooms first:
//   - LIVE rooms (spaces where status='live'): a gradient "live" ring; tapping
//     it deep-links straight into that room.
//   - ONLINE members (signed-in and recently active via the presence heartbeat,
//     but not hosting a room): a subtler ring linking to their profile. This is
//     what makes other online members appear here; previously the row only ever
//     showed live-room hosts, so members who were merely online never showed up.
//
// Data source is /api/mirror/live; we poll it on a light interval so the row
// tracks who's around without a reload, and we send our own presence heartbeat
// so this viewer shows up in everyone else's row too. When nobody is around we
// show a subtle "be the first" prompt rather than hiding the row.
export default function OnlineNowRow() {
  const [rooms, setRooms] = useState<MirrorLiveRoom[]>([]);
  const [members, setMembers] = useState<MirrorOnlineMember[]>([]);
  const [loaded, setLoaded] = useState(false);

  // Presence heartbeat: tell the server we're online so we appear in other
  // members' rows. Fire on mount and every 60s while the page is open.
  useEffect(() => {
    let active = true;
    const ping = () => {
      if (!active) return;
      authFetch("/api/presence/heartbeat", { method: "POST" }).catch(() => {
        /* transient — the next tick retries */
      });
    };
    ping();
    const t = setInterval(ping, 60_000);
    return () => {
      active = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const res = await fetch("/api/mirror/live", { cache: "no-store" });
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
  }, []);

  const isEmpty = rooms.length === 0 && members.length === 0;

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
            {rooms.map((room) => {
              const name =
                room.host?.display_name ||
                room.host?.username ||
                "Live";
              return (
                <Link
                  key={`room-${room.id}`}
                  href={roomHref(room)}
                  className="group flex shrink-0 flex-col items-center gap-2"
                  title={room.title ?? name}
                >
                  {/* Gradient "live" ring around the host avatar. */}
                  <span className="rounded-full bg-gradient-to-tr from-brand-primary via-melori-pink to-melori-purple p-[2px]">
                    <span className="block rounded-full bg-melori-void p-[2px]">
                      <CoverImage
                        src={room.host?.avatar_url ?? null}
                        alt={name}
                        name={name}
                        className="h-14 w-14"
                        rounded="rounded-full"
                      />
                    </span>
                  </span>
                  <span className="flex max-w-[4.5rem] items-center gap-1 truncate text-center text-xs text-white">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-primary" />
                    <span className="truncate">{name}</span>
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
                >
                  {/* Subtle static ring: online, but not broadcasting a room. */}
                  <span className="rounded-full bg-white/15 p-[2px]">
                    <span className="block rounded-full bg-melori-void p-[2px]">
                      <CoverImage
                        src={member.avatar_url ?? null}
                        alt={name}
                        name={name}
                        className="h-14 w-14"
                        rounded="rounded-full"
                      />
                    </span>
                  </span>
                  <span className="flex max-w-[4.5rem] items-center gap-1 truncate text-center text-xs text-melori-muted">
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    <span className="truncate">{name}</span>
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
