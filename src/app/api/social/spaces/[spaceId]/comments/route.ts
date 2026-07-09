import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireSuperfan, isGuardFailure } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/spaces/[spaceId]/comments — Public. Reading is free.
// Returns newest first, up to 200.
export async function GET(
  _req: NextRequest,
  { params }: { params: { spaceId: string } },
) {
  const spaceId = String(params.spaceId ?? "").trim();
  if (!spaceId || !isUuid(spaceId)) {
    // Return an empty list rather than 400 so the client's polling doesn't
    // spam errors during page navigation with a not-yet-resolved id.
    return NextResponse.json({ comments: [] });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("space_comments_with_author")
      .select("id, user_id, author_display, avatar_url, username, verified, body, created_at")
      .eq("space_id", spaceId)
      .order("created_at", { ascending: false })
      .limit(200);

    if (error) {
      console.error("Space comments fetch error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ comments: data ?? [] });
  } catch (err: any) {
    console.error("Space comments GET exception:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to load comments" },
      { status: 500 },
    );
  }
}

// POST /api/social/spaces/[spaceId]/comments — Superfan+ only. Author is
// resolved from the verified bearer token; the request body only carries the
// message text.
export async function POST(
  req: NextRequest,
  { params }: { params: { spaceId: string } },
) {
  const spaceId = String(params.spaceId ?? "").trim();
  if (!spaceId || !isUuid(spaceId)) {
    return NextResponse.json({ error: "Invalid spaceId" }, { status: 400 });
  }

  const guard = await requireSuperfan(req);
  if (isGuardFailure(guard)) return guard;
  const { membership } = guard;

  // Space chat is fast-moving but still spammable. 5 quick, ~1/sec sustained.
  const rl = rateLimit(
    `social:space-comments:${membership.userId}`,
    5,
    1,
  );
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "You're posting too quickly. Please slow down." },
      {
        status: 429,
        headers: { "Retry-After": Math.ceil(rl.retryAfterMs / 1000).toString() },
      },
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const text = String(body.body ?? "").trim();
    if (!text) {
      return NextResponse.json(
        { error: "Comment cannot be empty" },
        { status: 400 },
      );
    }
    if (text.length > 2000) {
      return NextResponse.json(
        { error: "Comment must be 2000 characters or fewer" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseAdmin();

    // Confirm the space exists (avoid orphaned rows if the id is bad).
    const { data: space } = await supabase
      .from("spaces")
      .select("id")
      .eq("id", spaceId)
      .maybeSingle();
    if (!space) {
      return NextResponse.json({ error: "Space not found" }, { status: 404 });
    }

    // Resolve a friendly display name for this author from their profile.
    const { data: profile } = await supabase
      .from("profiles")
    .select("display_name, full_name, username, avatar_url")      
      .eq("id", membership.userId)
      .maybeSingle();

    const authorName =
      (profile?.display_name as string) ||
      (profile?.full_name as string) ||
      (profile?.username as string) ||
      "Superfan";

    const { data, error } = await supabase
      .from("space_comments")
      .insert({
        space_id: spaceId,
        user_id: membership.userId,
        author_name: authorName,
        body: text,
      })
      .select("id, user_id, author_name, body, created_at")
      .single();

    if (error) {
      console.error("Space comment insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ comment: { ...data, avatar_url: profile?.avatar_url ?? null, author_display: authorName, username: profile?.username ?? null } });  } catch (err: any) {
    console.error("Space comment POST exception:", err);
    return NextResponse.json(
      { error: err?.message ?? "Failed to post comment" },
      { status: 500 },
    );
  }
}
