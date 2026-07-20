import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sha256Hex, slugify } from "@/lib/gallery-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/studio/gallery/create — requireArtist. Creates a photo_galleries
// row owned by the caller with a unique slug (slugify+random hex, matching
// the CLI upload route's convention). Optional password is hashed with the
// SAME sha256Hex scheme /api/gallery/verify checks against.
export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;

  let body: {
    name?: string;
    clientName?: string;
    allowDownloads?: boolean;
    password?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }
  const clientName =
    typeof body.clientName === "string" && body.clientName.trim()
      ? body.clientName.trim()
      : null;
  const allowDownloads =
    typeof body.allowDownloads === "boolean" ? body.allowDownloads : true;
  const password =
    typeof body.password === "string" && body.password.trim()
      ? body.password.trim()
      : null;
  const passwordHash = password ? sha256Hex(password) : null;

  const supabase = getSupabaseAdmin();
  const slug = `${slugify(name) || "gallery"}-${randomBytes(4).toString("hex")}`;

  const { data: created, error } = await supabase
    .from("photo_galleries")
    .insert({
      photographer_id: userId,
      client_name: clientName,
      name,
      slug,
      allow_downloads: allowDownloads,
      password_hash: passwordHash,
    })
    .select("id, slug")
    .single();

  if (error || !created) {
    console.error("studio/gallery/create insert failed", error?.message);
    return NextResponse.json(
      { error: "Could not create gallery" },
      { status: 500 },
    );
  }

  return NextResponse.json({ id: created.id, slug: created.slug });
}
