import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { assertTrackOwnership, isOwnershipFailure, OWNER_COLUMN } from "@/lib/studio-ownership";

// PATCH /api/studio/track/[id]/preview — Update preview settings
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  try {
    const supabase = createServiceClient();
    const body = await req.json();

    const ownership = await assertTrackOwnership(
      supabase,
      params.id,
      guard.membership.userId
    );
    if (isOwnershipFailure(ownership)) return ownership;

    // Validate inputs. previewUrl, if present, must be a storage path/URL
    // in the caller's own studio folder — otherwise an artist could point
    // their preview at another artist's audio (or an arbitrary URL that
    // the client-side player would happily fetch and cache as "their" preview).
    const userId = guard.membership.userId;
    const update: Record<string, any> = { updated_at: new Date().toISOString() };

    if (body.previewUrl !== undefined) {
      if (body.previewUrl === null || body.previewUrl === "") {
        update.preview_url = null;
      } else if (typeof body.previewUrl !== "string") {
        return NextResponse.json({ error: "previewUrl must be a string" }, { status: 400 });
      } else {
        const folder = `studio/${userId}/`;
        // Accept either a bare storage path or a Supabase Storage URL that
        // includes the caller's studio folder.
        if (!body.previewUrl.includes(folder)) {
          return NextResponse.json(
            { error: "previewUrl must reference the caller's studio folder" },
            { status: 400 },
          );
        }
        if (body.previewUrl.length > 2048) {
          return NextResponse.json({ error: "previewUrl too long" }, { status: 400 });
        }
        update.preview_url = body.previewUrl;
      }
    }

    if (body.previewStart !== undefined) {
      const s = Number(body.previewStart);
      if (!Number.isFinite(s) || s < 0 || s > 60 * 60) {
        return NextResponse.json({ error: "previewStart out of range" }, { status: 400 });
      }
      update.preview_start = s;
    }
    if (body.previewEnd !== undefined) {
      const e = Number(body.previewEnd);
      if (!Number.isFinite(e) || e < 0 || e > 60 * 60) {
        return NextResponse.json({ error: "previewEnd out of range" }, { status: 400 });
      }
      update.preview_end = e;
    }
    if (
      typeof update.preview_start === "number" &&
      typeof update.preview_end === "number" &&
      update.preview_end <= update.preview_start
    ) {
      return NextResponse.json(
        { error: "previewEnd must be greater than previewStart" },
        { status: 400 },
      );
    }

    const { error } = await supabase
      .from("studio_tracks")
      .update(update)
      .eq("id", params.id)
      .eq(OWNER_COLUMN, userId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
