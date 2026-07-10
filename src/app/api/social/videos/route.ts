import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Extract a YouTube video ID from common URL formats. Returns null if the
// URL is not a recognizable YouTube link.
function parseYouTubeId(raw: string): string | null {
  try {
    const u = new URL(raw.trim());
    const host = u.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = u.pathname.slice(1).split("/")[0];
      return /^[A-Za-z0-9_-]{6,}$/.test(id) ? id : null;
    }
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (u.pathname === "/watch") {
        const v = u.searchParams.get("v") || "";
        return /^[A-Za-z0-9_-]{6,}$/.test(v) ? v : null;
      }
      const m = u.pathname.match(/^\/(?:shorts|embed|v)\/([A-Za-z0-9_-]{6,})/);
      if (m) return m[1];
    }
    return null;
  } catch {
    return null;
  }
}

// GET /api/social/videos — public video feed (most recent first).
export async function GET() {
  try {
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("social_videos")
      .select(
        `*, user:profiles(id, display_name, avatar_url, role, verified)`,
      )
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Social videos list error:", error);
      return NextResponse.json({ videos: [] }, { status: 500 });
    }

    return NextResponse.json({ videos: data ?? [] });
  } catch (err) {
    console.error("Social videos GET error:", err);
    return NextResponse.json({ videos: [] }, { status: 500 });
  }
}

// POST /api/social/videos — persist a video row. Accepts either a native
// storage URL (uploaded via /api/studio/upload-url) or a YouTube link.
// Only artists/admins may publish (requireArtist). user_id is always the
// caller's uid so a client cannot post on someone else's behalf.
export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const rawUrl = typeof body.video_url === "string" ? body.video_url.trim() : "";
    const description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
    let thumbnailUrl =
      typeof body.thumbnail_url === "string" && body.thumbnail_url
        ? body.thumbnail_url
        : null;

    if (!title) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    if (!rawUrl) {
      return NextResponse.json({ error: "video_url is required" }, { status: 400 });
    }

    // If this is a YouTube link, normalize it and derive a thumbnail.
    // Native storage URLs pass through unchanged.
    let videoUrl = rawUrl;
    const ytId = parseYouTubeId(rawUrl);
    if (ytId) {
      videoUrl = `https://www.youtube.com/watch?v=${ytId}`;
      if (!thumbnailUrl) {
        thumbnailUrl = `https://img.youtube.com/vi/${ytId}/hqdefault.jpg`;
      }
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from("social_videos")
      .insert({
        user_id: guard.membership.userId,
        title,
        description,
        video_url: videoUrl,
        thumbnail_url: thumbnailUrl,
      })
      .select("*")
      .single();

    if (error) {
      console.error("Social video insert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    revalidatePath("/");
    revalidatePath("/social/video");
    revalidatePath("/video");
    return NextResponse.json({ ...data, success: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Create social video error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
