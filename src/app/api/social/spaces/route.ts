import { NextRequest, NextResponse } from "next/server";
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
    const { data, error } = await supabase
      .from("spaces")
      .insert({
        title,
        topic: String(body.topic ?? "").trim() || "Open Discussion",
        type: body.type ?? "listening",
        host_id: membership.userId,
        status: scheduledAt ? "scheduled" : "live",
        scheduled_at: scheduledAt,
        agora_channel: `melori_${Date.now()}`,
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
