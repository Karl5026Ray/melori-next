import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/waves?direction=incoming|outgoing|all
// Lists the caller's pending/accepted waves.
export async function GET(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { userId } = guard.membership;

  const direction = new URL(req.url).searchParams.get("direction") ?? "incoming";
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("waves")
    .select(
      `id, sender_id, recipient_id, message, status, conversation_id,
       created_at, expires_at, responded_at,
       sender:profiles!waves_sender_id_fkey(id, display_name, avatar_url, role, verified),
       recipient:profiles!waves_recipient_id_fkey(id, display_name, avatar_url, role, verified)`,
    )
    .order("created_at", { ascending: false })
    .limit(50);

  if (direction === "incoming") {
    query = query.eq("recipient_id", userId);
  } else if (direction === "outgoing") {
    query = query.eq("sender_id", userId);
  } else {
    query = query.or(`sender_id.eq.${userId},recipient_id.eq.${userId}`);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ waves: data ?? [] });
}

// POST /api/social/waves
// Send a wave (a private-chat invite). Body: { recipient_id, message? }
// - Superfan+ required (sender).
// - Recipient can be any profile.
// - Unique index prevents duplicate pending waves.
export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { userId: senderId } = guard.membership;

  const body = await req.json().catch(() => ({}));
  const recipientId = String(body.recipient_id ?? "").trim();
  const message = body.message ? String(body.message).slice(0, 240) : null;

  if (!recipientId) {
    return NextResponse.json(
      { error: "recipient_id required" },
      { status: 400 },
    );
  }
  if (recipientId === senderId) {
    return NextResponse.json(
      { error: "Cannot wave at yourself" },
      { status: 400 },
    );
  }

  const supabase = getSupabaseAdmin();

  // Confirm recipient exists.
  const { data: recipient } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", recipientId)
    .maybeSingle();
  if (!recipient) {
    return NextResponse.json({ error: "Recipient not found" }, { status: 404 });
  }

  const { data, error } = await supabase
    .from("waves")
    .insert({
      sender_id: senderId,
      recipient_id: recipientId,
      message,
    })
    .select()
    .single();

  if (error) {
    // Unique-violation → user already has a pending wave to this recipient.
    if (error.code === "23505") {
      return NextResponse.json(
        { error: "You already have a pending wave to this user" },
        { status: 409 },
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ wave: data });
}
