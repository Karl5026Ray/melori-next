import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/community/comments — Public. Reading is free (incl. logged-out).
// Returns comments newest first. Reads via the service role client because RLS
// is ON for public.community_comments.
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("community_comments")
      .select("id, user_id, author_name, body, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("Community comments fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ comments: data ?? [] });
  } catch (err: any) {
    console.error("Community comments GET exception:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to load comments" },
      { status: 500 },
    );
  }
}

// POST /api/community/comments — Posting requires an active Superfan-or-better
// member (requireSuperfan → 401/403 otherwise). The author is resolved from the
// verified bearer token, never from the request body — no client-supplied
// user_id is trusted. Inserts via the service role client (RLS is ON).
export async function POST(req: NextRequest) {
  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  try {
    const body = await req.json().catch(() => ({}));
    const text = String(body.body ?? "").trim();
    if (!text) {
      return NextResponse.json(
        { error: "Comment cannot be empty" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    // Resolve a friendly author name server-side from the authenticated user.
    const { data: profile } = await supabase
      .from("profiles")
      .select("display_name, full_name, username")
      .eq("id", membership.userId)
      .maybeSingle();

    const authorName =
      (profile?.display_name as string) ||
      (profile?.full_name as string) ||
      (profile?.username as string) ||
      "Superfan";

    const { data, error } = await supabase
      .from("community_comments")
      .insert({
        user_id: membership.userId,
        author_name: authorName,
        body: text,
      })
      .select("id, user_id, author_name, body, created_at")
      .single();

    if (error) {
      console.error("Community comment insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ comment: data });
  } catch (err: any) {
    console.error("Community comment POST exception:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to post comment" },
      { status: 500 },
    );
  }
}
