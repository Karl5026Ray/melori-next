import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("admin_session")?.value;
  const secret = getAdminSecret();
  if (!token || !secret) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(secret));
    return true;
  } catch {
    return false;
  }
}

// Map a content_type to the table + status column used to hide/restore the item.
const CONTENT_TABLE: Record<string, { table: string; idText: boolean }> = {
  message: { table: "messages", idText: false },
  comment: { table: "community_comments", idText: false },
  gallery: { table: "profile_gallery", idText: false },
  video: { table: "profile_gallery", idText: false },
  track: { table: "tracks", idText: false },
};

// GET /api/admin/moderation/queue
//   Returns { moderation: [...open auto-decisions], reports: [...open reports] }.
export async function GET(req: NextRequest) {
  if (!getAdminSecret()) {
    return NextResponse.json({ error: "Admin auth is not configured." }, { status: 503 });
  }
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();
  const [modRes, repRes] = await Promise.all([
    supabase
      .from("content_moderation")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("content_reports")
      .select("*")
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  return NextResponse.json({
    moderation: modRes.data ?? [],
    reports: repRes.data ?? [],
    moderationError: modRes.error?.message ?? null,
    reportsError: repRes.error?.message ?? null,
  });
}

// POST /api/admin/moderation/queue
//   Take an action on a queue item.
//   Body: {
//     kind: 'moderation'|'report',
//     id: string,                     // queue row id
//     action: 'approve'|'remove'|'dismiss',
//     content_type?: string,          // needed to update the underlying row
//     content_id?: string,
//   }
//   - approve  : underlying row -> moderation_status 'clean'  (make it public)
//   - remove   : underlying row -> moderation_status 'removed' (hide it)
//   - dismiss  : just close the queue item (no change to content)
export async function POST(req: NextRequest) {
  if (!getAdminSecret()) {
    return NextResponse.json({ error: "Admin auth is not configured." }, { status: 503 });
  }
  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const kind = String(body.kind ?? "");
  const id = String(body.id ?? "");
  const action = String(body.action ?? "");
  const contentType = body.content_type ? String(body.content_type) : null;
  const contentId = body.content_id ? String(body.content_id) : null;

  if (!id || !["moderation", "report"].includes(kind) || !["approve", "remove", "dismiss"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  // Apply the effect to the underlying content row for approve/remove.
  if ((action === "approve" || action === "remove") && contentType && contentId) {
    const map = CONTENT_TABLE[contentType];
    if (map) {
      const newStatus = action === "approve" ? "clean" : "removed";
      const { error: rowErr } = await supabase
        .from(map.table)
        .update({ moderation_status: newStatus, moderated_at: new Date().toISOString() })
        .eq("id", contentId);
      if (rowErr) {
        console.error("Moderation row update error:", rowErr);
        // Continue: still close the queue item so it doesn't get stuck.
      }
    } else if (contentType === "bio" || contentType === "avatar" || contentType === "banner") {
      // Profile-level: on remove, blank the offending field.
      if (action === "remove") {
        const patch: Record<string, unknown> = {};
        if (contentType === "bio") {
          patch.bio = null;
          patch.bio_moderation_status = "removed";
        }
        if (contentType === "avatar") patch.avatar_url = null;
        if (contentType === "banner") patch.banner_url = null;
        await supabase.from("profiles").update(patch).eq("id", contentId);
      } else if (contentType === "bio") {
        await supabase.from("profiles").update({ bio_moderation_status: "clean", bio_moderation_reason: null }).eq("id", contentId);
      }
    }
  }

  // Close the queue item.
  const queueTable = kind === "moderation" ? "content_moderation" : "content_reports";
  const finalStatus =
    kind === "moderation"
      ? action === "approve"
        ? "approved"
        : action === "remove"
          ? "removed"
          : "dismissed"
      : action === "dismiss"
        ? "dismissed"
        : "actioned";

  const { error } = await supabase
    .from(queueTable)
    .update({ status: finalStatus, reviewed_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    console.error("Queue update error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
