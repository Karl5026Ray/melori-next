import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/social/spaces — Create (host) an MM Social space.
// Participation (creating/posting) requires an active Superfan-or-better member.
// The host is taken from the verified token, never from the request body.
export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  try {
    const body = await req.json();
    const title = String(body.title ?? "").trim();
    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (title.length > 200) {
      return NextResponse.json(
        { error: "Title must be 200 characters or fewer" },
        { status: 400 },
      );
    }
    const topic = String(body.topic ?? "").trim();
    if (topic.length > 500) {
      return NextResponse.json(
        { error: "Topic must be 500 characters or fewer" },
        { status: 400 },
      );
    }
    const ALLOWED_TYPES = new Set(["listening", "discussion", "creation", "dj_set"]);
    const type =
      typeof body.type === "string" && ALLOWED_TYPES.has(body.type)
        ? body.type
        : "listening";

        const ALLOWED_FORMATS = new Set([
      "release_party",
      "discussion",
      "versus_battle",
      "dj_set",
    ]);
    const room_format =
      typeof body.room_format === "string" && ALLOWED_FORMATS.has(body.room_format)
        ? (body.room_format as string)
        : null;

    // Optional scheduled_at → room is created in `scheduled` status; the
    // host can go live later. Otherwise defaults to live-now.
    let scheduledAt: string | null = null;
    if (body.scheduled_at) {
      const t = new Date(String(body.scheduled_at));
      if (Number.isNaN(t.getTime())) {
        return NextResponse.json(
          { error: "Invalid scheduled_at" },
          { status: 400 },
        );
      }
      if (t.getTime() < Date.now() - 60_000) {
        return NextResponse.json(
          { error: "scheduled_at must be in the future" },
          { status: 400 },
        );
      }
      scheduledAt = t.toISOString();
    }

    const supabase = getSupabaseAdmin();

        // One active room per host: gracefully end any prior non-ended space by
    // this user before starting a new one (Clubhouse-style single-room rule).
    // Best-effort — failures here should not block room creation.
    try {
      await supabase
        .from("spaces")
        .update({ status: "ended", ended_at: new Date().toISOString() })
        .eq("host_id", membership.userId)
        .neq("status", "ended");
    } catch (endErr) {
      console.warn("one-active-room cleanup failed", endErr);
    }
    const { data, error } = await supabase
      .from("spaces")
      .insert({
        title,
        topic: topic || "Open Discussion",
        type,
                room_format,
        host_id: membership.userId,
        status: scheduledAt ? "scheduled" : "live",
        scheduled_at: scheduledAt,
        // Agora channel names must be unique per active room. Using Date.now()
        // alone could collide if two spaces were created in the same tick; add
        // 6 random hex chars so concurrent creates each get their own channel.
        agora_channel: `melori_${Date.now()}_${randomBytes(3).toString("hex")}`,
      })
      .select()
      .single();

    if (error) {
      console.error("Create space error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ space: data });
  } catch (err: any) {
    console.error("Create space exception:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to create space" },
      { status: 500 },
    );
  }
}
