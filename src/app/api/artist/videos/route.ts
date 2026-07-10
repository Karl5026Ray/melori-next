import { NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/artist/videos — list the caller's own native videos.
export async function GET(req: Request) {
const guard = await requireArtist(req);
if (isGuardFailure(guard)) return guard;
const supabase = getSupabaseAdmin();

const { data: artist } = await supabase
.from("artists").select("id").eq("profile_id", guard.membership.userId).maybeSingle();

const { data, error } = await supabase
.from("videos")
.select("id, title, description, file_path, thumbnail_url, duration_seconds, views, status, source, created_at")
.eq("source", "native")
.eq("artist_id", artist?.id ?? -1)
.order("created_at", { ascending: false });

if (error) {
console.error("List videos error:", error);
return NextResponse.json({ error: "Failed to load videos" }, { status: 500 });
}
return NextResponse.json({ videos: data ?? [] });
}

// POST /api/artist/videos — create a native video row after the file (and
// optional thumbnail) have been uploaded via /api/artist/video-upload-url.
// artist_id is resolved server-side from the session (identity continuity),
// and file_path is verified to live in the caller's own folder.
export async function POST(req: Request) {
const guard = await requireArtist(req);
if (isGuardFailure(guard)) return guard;

let body: Record<string, unknown>;
try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

const title = String(body.title ?? "").trim();
const filePath = String(body.file_path ?? "").trim();
const description = body.description ? String(body.description).trim() : null;
const thumbnailUrl = body.thumbnail_url ? String(body.thumbnail_url).trim() : null;
const durationSeconds = Number(body.duration_seconds);
const fileSizeBytes = Number(body.file_size_bytes);

if (!title || title.length > 200) return NextResponse.json({ error: "title required (<=200)" }, { status: 400 });
if (!filePath || filePath.length > 2048) return NextResponse.json({ error: "file_path required" }, { status: 400 });

// Path scoping: prevent cross-tenant impersonation / traversal.
const userId = guard.membership.userId!;
if (!filePath.startsWith(`${userId}/`) || filePath.includes("..")) {
return NextResponse.json({ error: "file_path must be in your own folder" }, { status: 403 });
}

const supabase = getSupabaseAdmin();
const { data: artist } = await supabase
.from("artists").select("id").eq("profile_id", userId).maybeSingle();

const { data, error } = await supabase.from("videos").insert({
title,
description,
file_path: filePath,
thumbnail_url: thumbnailUrl,
duration_seconds: Number.isFinite(durationSeconds) && durationSeconds >= 0 ? Math.round(durationSeconds) : null,
file_size_bytes: Number.isFinite(fileSizeBytes) && fileSizeBytes >= 0 ? Math.round(fileSizeBytes) : null,
artist_id: artist?.id ?? null,
source: "native",
status: "published",
is_active: true,
}).select("id").single();

if (error) {
console.error("Create video error:", error);
return NextResponse.json({ error: "Failed to create video" }, { status: 500 });
}
return NextResponse.json({ id: data.id }, { status: 201 });
}
