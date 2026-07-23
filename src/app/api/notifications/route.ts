import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/notifications          → { notifications, unread }
// PATCH /api/notifications         → mark one ({ id }) or all ({ all:true }) read
// Presentation fields live in the `data` jsonb: { title, body, link }.
// Every query is scoped by the authenticated user id (service role bypasses RLS).

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId!;

  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("api/notifications GET error:", error.message);
    return NextResponse.json({ error: "Could not load notifications" }, { status: 500 });
  }

  const notifications = data ?? [];
  const unread = notifications.filter((n) => n.read === false).length;
  return NextResponse.json({ notifications, unread });
}

export async function PATCH(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId!;

  let body: { id?: string; all?: boolean };
  try {
    body = (await req.json()) as { id?: string; all?: boolean };
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  if (body.all) {
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false);
    if (error) {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (body.id) {
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("id", body.id);
    if (error) {
      return NextResponse.json({ error: "Update failed" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Provide id or all" }, { status: 400 });
}
