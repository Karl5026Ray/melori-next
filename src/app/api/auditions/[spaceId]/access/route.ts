import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { isUuid } from "@/lib/validators";
import { deriveRoomName } from "@/lib/endRoom";
import { livekitConfigured, removeLiveKitParticipant } from "@/lib/livekitServer";
import { directorOnly, isContextFailure, loadAuditionContext } from "@/lib/auditions.server";
import { nextStatusFor, type DirectorAction } from "@/lib/auditions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIONS = new Set<DirectorAction>(["admit", "lobby", "deny"]);

// POST /api/auditions/[spaceId]/access — the director runs the door.
//
//   { user_id, action: "admit" | "lobby" | "deny" }  — move an actor
//   { user_id, character_name }                       — set the part they read
//   { username, action: "invite" }                    — name someone for a
//                                                       private room / callback
//
// Sending someone back to the lobby or denying them also drops them from the
// LiveKit room right away; their next token request is refused because the
// token route reads space_access.
export async function POST(req: NextRequest, { params }: { params: Promise<{ spaceId: string }> }) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const ctx = await loadAuditionContext((await params).spaceId, guard.membership.userId!);
  if (isContextFailure(ctx)) return ctx;
  const notDirector = directorOnly(ctx);
  if (notDirector) return notDirector;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const supabase = getSupabaseAdmin();
  const now = new Date().toISOString();

  // Named invite by username.
  if (body.action === "invite") {
    const username = String(body.username ?? "").trim().replace(/^@/, "");
    if (!username || username.length > 60) {
      return NextResponse.json({ error: "Enter their Melori username" }, { status: 400 });
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("username", username)
      .maybeSingle();
    if (!profile) return NextResponse.json({ error: "No member with that username" }, { status: 404 });
    if (profile.id === ctx.room.host_id) {
      return NextResponse.json({ error: "That's you" }, { status: 400 });
    }
    const { data: existing } = await supabase
      .from("space_access")
      .select("status")
      .eq("space_id", ctx.room.id)
      .eq("user_id", profile.id)
      .maybeSingle();
    // Never downgrade someone already waiting or in the room.
    if (!existing || existing.status === "denied") {
      const { error } = await supabase.from("space_access").upsert(
        { space_id: ctx.room.id, user_id: profile.id, status: "invited", updated_at: now, decided_by: ctx.userId },
        { onConflict: "space_id,user_id" },
      );
      if (error) return NextResponse.json({ error: "Could not add them" }, { status: 500 });
    }
    return NextResponse.json({ ok: true, user_id: profile.id });
  }

  if (!isUuid(body.user_id) || body.user_id === ctx.room.host_id) {
    return NextResponse.json({ error: "Pick an actor" }, { status: 400 });
  }
  const userId = body.user_id;

  const { data: row } = await supabase
    .from("space_access")
    .select("status")
    .eq("space_id", ctx.room.id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "They aren't in this room" }, { status: 404 });

  const update: Record<string, unknown> = { updated_at: now, decided_by: ctx.userId };

  if (body.character_name !== undefined) {
    const name = String(body.character_name ?? "").trim();
    if (name.length > 80) {
      return NextResponse.json({ error: "Character name is too long" }, { status: 400 });
    }
    update.character_name = name || null;
  }

  let action: DirectorAction | null = null;
  if (body.action !== undefined) {
    if (!ACTIONS.has(body.action as DirectorAction)) {
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    }
    action = body.action as DirectorAction;
    update.status = nextStatusFor(action);
  }

  const { error } = await supabase
    .from("space_access")
    .update(update)
    .eq("space_id", ctx.room.id)
    .eq("user_id", userId);
  if (error) return NextResponse.json({ error: "Could not update" }, { status: 500 });

  if (action === "lobby" || action === "deny") {
    await supabase
      .from("space_participants")
      .update({ role: "audience", left_at: now })
      .eq("space_id", ctx.room.id)
      .eq("user_id", userId)
      .is("left_at", null);
    if (livekitConfigured()) {
      await removeLiveKitParticipant(
        deriveRoomName({ id: ctx.room.id, livekit_room: ctx.room.livekit_room }),
        userId,
      );
    }
  }

  return NextResponse.json({ ok: true, status: update.status ?? row.status });
}
