import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import {
  MAX_CINEMA_PLAYLIST_ITEMS,
  classifySource,
} from "@/lib/cinemaPlayback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Playback control for an MM Cinema room.
//
// GET  — anyone may read the room's playback state.
// PUT  — ONLY the room's host may write it.
//
// That asymmetry is the entire security model of the shared screen. There is
// deliberately no RLS write policy on room_playback_state (migration 051), so
// this route is the single path to changing what a room is watching. If a
// guest could write, any guest could seize the screen mid-broadcast.

/** Extrapolation epoch for clients: our clock, so they can measure their skew. */
function serverNow() {
  return new Date().toISOString();
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const { spaceId: raw } = await params;
  const spaceId = String(raw ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: space, error: spaceError } = await supabase
    .from("spaces")
    .select("id, room_format, status")
    .eq("id", spaceId)
    .maybeSingle();
  if (spaceError) {
    return NextResponse.json({ error: spaceError.message }, { status: 500 });
  }
  if (!space) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  if (space.room_format !== "cinema") {
    return NextResponse.json({ error: "This room is not a Cinema room" }, { status: 409 });
  }
  if (space.status === "ended") {
    return NextResponse.json({ error: "This room has ended" }, { status: 409 });
  }

  const { data, error } = await supabase
    .from("room_playback_state")
    .select("*")
    .eq("space_id", spaceId)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A room with no row yet is normal, not an error: the host hasn't picked
  // anything to watch. Return null state plus the clock so the guest can still
  // calibrate before the first source lands.
  return NextResponse.json({ state: data ?? null, server_now: serverNow() });
}

interface PlaybackPatch {
  source_url?: unknown;
  source_type?: unknown;
  position_seconds?: unknown;
  duration_seconds?: unknown;
  is_playing?: unknown;
}

type PlaylistBody = {
  expected_revision?: unknown;
  action?: unknown;
  item?: {
    source_url?: unknown;
    source_type?: unknown;
    title?: unknown;
    library_video_id?: unknown;
  };
  item_id?: unknown;
  ended_item_id?: unknown;
  to_index?: unknown;
};

const PLAYLIST_ACTIONS = new Set([
  "append",
  "move",
  "remove",
  "select",
  "advance",
  "clear",
]);

function rpcStatus(code?: string): number {
  if (code === "40001") return 409;
  if (code === "42501") return 403;
  if (code === "P0002") return 404;
  if (code === "22023") return 400;
  if (code === "55000") return 409;
  return 500;
}

/**
 * Host-only queue mutation. The database function repeats the host check and
 * locks the room row; the route owns URL canonicalization and readable HTTP
 * errors. Keeping both layers means a second host tab cannot silently clobber
 * a newer reorder or double-advance an ended item.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const { spaceId: raw } = await params;
  const spaceId = String(raw ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  let body: PlaylistBody;
  try {
    body = (await req.json()) as PlaylistBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const action = typeof body.action === "string" ? body.action : "";
  if (!PLAYLIST_ACTIONS.has(action)) {
    return NextResponse.json({ error: "Unknown playlist action" }, { status: 400 });
  }
  const expectedRevision = Number(body.expected_revision);
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    return NextResponse.json(
      { error: "expected_revision must be a non-negative integer" },
      { status: 400 },
    );
  }

  const command: Record<string, unknown> = { action };
  if (action === "append") {
    const rawUrl = body.item?.source_url;
    if (typeof rawUrl !== "string") {
      return NextResponse.json({ error: "A source URL is required" }, { status: 400 });
    }
    const classified = classifySource(rawUrl);
    if (!classified.ok) {
      return NextResponse.json({ error: classified.reason }, { status: 400 });
    }
    if (
      body.item?.source_type !== undefined &&
      body.item.source_type !== classified.type
    ) {
      return NextResponse.json(
        { error: "source_type must match the validated source URL" },
        { status: 400 },
      );
    }
    const title =
      typeof body.item?.title === "string" ? body.item.title.trim().slice(0, 200) : null;
    const libraryVideoId =
      typeof body.item?.library_video_id === "string"
        ? body.item.library_video_id.trim() || null
        : null;
    command.item = {
      id: randomUUID(),
      source_url: classified.url,
      source_type: classified.type,
      ...(title ? { title } : {}),
      ...(libraryVideoId ? { library_video_id: libraryVideoId } : {}),
    };
  } else if (action === "move") {
    const toIndex = Number(body.to_index);
    if (
      typeof body.item_id !== "string" ||
      !Number.isInteger(toIndex) ||
      toIndex < 0 ||
      toIndex >= MAX_CINEMA_PLAYLIST_ITEMS
    ) {
      return NextResponse.json(
        { error: "move requires item_id and a valid to_index" },
        { status: 400 },
      );
    }
    command.item_id = body.item_id;
    command.to_index = toIndex;
  } else if (action === "remove" || action === "select") {
    if (typeof body.item_id !== "string" || !body.item_id.trim()) {
      return NextResponse.json({ error: "item_id is required" }, { status: 400 });
    }
    command.item_id = body.item_id;
  } else if (action === "advance") {
    if (typeof body.ended_item_id !== "string" || !body.ended_item_id.trim()) {
      return NextResponse.json(
        { error: "ended_item_id is required" },
        { status: 400 },
      );
    }
    command.ended_item_id = body.ended_item_id;
  }

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc("mutate_cinema_playlist", {
    p_space_id: spaceId,
    p_expected_revision: expectedRevision,
    p_command: command,
    p_actor_id: userId,
  });

  if (error) {
    const status = rpcStatus(error.code);
    if (status === 409 && error.code === "40001") {
      const { data: current } = await supabase
        .from("room_playback_state")
        .select("*")
        .eq("space_id", spaceId)
        .maybeSingle();
      return NextResponse.json(
        {
          error: "The playlist changed in another host session. It has been refreshed.",
          state: current ?? null,
          server_now: serverNow(),
        },
        { status },
      );
    }
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ state: data, server_now: serverNow() });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ spaceId: string }> },
) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  const { spaceId: raw } = await params;
  const spaceId = String(raw ?? "").trim();
  if (!spaceId) {
    return NextResponse.json({ error: "spaceId is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Host check against the DATABASE, not against anything the client sent.
  // Also confirms the room is a Cinema room and still open — writing playback
  // into an ended room would leave a row that a stale client could act on.
  const { data: space, error: spaceErr } = await supabase
    .from("spaces")
    .select("id, host_id, status, room_format")
    .eq("id", spaceId)
    .maybeSingle();

  if (spaceErr) {
    return NextResponse.json({ error: spaceErr.message }, { status: 500 });
  }
  if (!space) {
    return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }
  if (space.host_id !== userId) {
    return NextResponse.json(
      { error: "Only the host controls the screen" },
      { status: 403 },
    );
  }
  if (space.room_format !== "cinema") {
    return NextResponse.json(
      { error: "This room is not a Cinema room" },
      { status: 409 },
    );
  }
  if (space.status === "ended") {
    return NextResponse.json({ error: "This room has ended" }, { status: 409 });
  }

  let body: PlaybackPatch;
  try {
    body = (await req.json()) as PlaybackPatch;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Build the patch field by field. Only keys the client actually sent are
  // touched, so a heartbeat that reports position doesn't accidentally clear
  // the source, and a pause doesn't reset duration.
  const patch: Record<string, unknown> = {
    space_id: spaceId,
    updated_by: userId,
  };

  // Source validation needs the final URL/type pair, so read the current row
  // once when the patch changes either half of the pair. This stops a caller
  // from pairing arbitrary https with "youtube" (or vice versa).
  let existingSource: { source_url: string | null; source_type: string } | null = null;
  if ("source_url" in body || "source_type" in body) {
    const { data: current, error: currentError } = await supabase
      .from("room_playback_state")
      .select("source_url, source_type")
      .eq("space_id", spaceId)
      .maybeSingle();
    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 });
    existingSource = current;
  }

  if ("source_url" in body) {
    const url = body.source_url;
    if (url !== null && typeof url !== "string") {
      return NextResponse.json({ error: "source_url must be a string or null" }, { status: 400 });
    }
    patch.source_url = typeof url === "string" ? url.trim() || null : null;
  }

  if ("source_type" in body) {
    const type = body.source_type;
    // Mirrors the room_playback_state CHECK constraint from migration 051. A
    // value the database would reject should fail here with a readable message
    // rather than as a 500 from Postgres.
    if (type !== "url" && type !== "youtube") {
      return NextResponse.json(
        { error: "source_type must be 'url' or 'youtube'" },
        { status: 400 },
      );
    }
    patch.source_type = type;
  }

  if ("source_url" in body || "source_type" in body) {
    const nextUrl =
      "source_url" in patch ? (patch.source_url as string | null) : existingSource?.source_url ?? null;
    const nextType =
      "source_type" in patch
        ? (patch.source_type as string)
        : existingSource?.source_type ?? "url";
    if (nextUrl) {
      const classified = classifySource(nextUrl);
      if (!classified.ok) {
        return NextResponse.json({ error: classified.reason }, { status: 400 });
      }
      if (classified.type !== nextType) {
        return NextResponse.json(
          { error: "source_type must match the validated source URL" },
          { status: 400 },
        );
      }
      patch.source_url = classified.url;
      patch.source_type = classified.type;
    }
  }

  if ("position_seconds" in body) {
    const pos = Number(body.position_seconds);
    if (!Number.isFinite(pos) || pos < 0) {
      return NextResponse.json(
        { error: "position_seconds must be a non-negative number" },
        { status: 400 },
      );
    }
    patch.position_seconds = pos;
  }

  if ("duration_seconds" in body) {
    const dur = body.duration_seconds;
    if (dur === null) {
      patch.duration_seconds = null;
    } else {
      const n = Number(dur);
      if (!Number.isFinite(n) || n < 0) {
        return NextResponse.json(
          { error: "duration_seconds must be a non-negative number or null" },
          { status: 400 },
        );
      }
      patch.duration_seconds = n;
    }
  }

  if ("is_playing" in body) {
    if (typeof body.is_playing !== "boolean") {
      return NextResponse.json({ error: "is_playing must be a boolean" }, { status: 400 });
    }
    patch.is_playing = body.is_playing;
  }

  // Upsert on space_id: the first control the host touches creates the row.
  // `updated_at` is intentionally NOT set here — the trigger stamps it with the
  // database clock, which is the epoch every guest extrapolates from.
  if ("source_url" in body || "source_type" in body) {
    const nextUrl =
      "source_url" in patch
        ? (patch.source_url as string | null)
        : existingSource?.source_url ?? null;
    const nextType =
      "source_type" in patch
        ? (patch.source_type as string)
        : existingSource?.source_type ?? "url";
    const command =
      nextUrl == null
        ? { action: "legacy_source_set" }
        : {
            action: "legacy_source_set",
            item: {
              source_url: nextUrl,
              source_type: nextType,
            },
          };
    const { data, error } = await supabase.rpc("mutate_cinema_playlist", {
      p_space_id: spaceId,
      p_expected_revision: null,
      p_command: command,
      p_actor_id: userId,
    });
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: rpcStatus(error.code) },
      );
    }
    return NextResponse.json({ state: data, server_now: serverNow() });
  }

  const { data, error } = await supabase
    .from("room_playback_state")
    .upsert(patch, { onConflict: "space_id" })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ state: data, server_now: serverNow() });
}
