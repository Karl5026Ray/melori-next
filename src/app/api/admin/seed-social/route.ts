import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecret } from "@/lib/admin-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyAdmin(req: NextRequest) {
  const token = req.cookies.get("admin_session")?.value;
  if (!token) return false;
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(ADMIN_SECRET));
    return true;
  } catch {
    return false;
  }
}

// POST /api/admin/seed-social
// Admin-only, idempotent (title-uniqueness) seeder for MM Social. Creates:
//   • 4 demo spaces (mix of scheduled + live)
//   • 3 welcome/community posts
// Safe to run repeatedly — existing rows with the same title are left alone.
export async function POST(req: NextRequest) {
  const ADMIN_SECRET = getAdminSecret();
  if (!ADMIN_SECRET) {
    return NextResponse.json(
      { error: "Admin auth is not configured on this server." },
      { status: 503 },
    );
  }

  if (!(await verifyAdmin(req))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // Pick a host: first admin profile if any, otherwise first profile in DB.
  const { data: hostProfile } = await supabase
    .from("profiles")
    .select("id, display_name, username, full_name")
    .order("role", { ascending: false }) // 'admin' sorts after some strings, but we just want deterministic
    .limit(1)
    .maybeSingle();

  if (!hostProfile) {
    return NextResponse.json(
      { error: "No profile found to host demo spaces. Create at least one user first." },
      { status: 400 },
    );
  }

  const hostName =
    hostProfile.display_name ||
    hostProfile.full_name ||
    hostProfile.username ||
    "Melori Music";

  const demoSpaces = [
    {
      title: "Welcome to Melori Spaces",
      topic: "Say hi and get oriented with the Clubhouse-style rooms.",
      type: "discussion",
      status: "scheduled",
    },
    {
      title: "Weekly Listening Party",
      topic: "Fresh drops from independent artists on Melori.",
      type: "listening",
      status: "scheduled",
    },
    {
      title: "Production Tips & Tricks",
      topic: "Sharing mixing, mastering, and songwriting workflows.",
      type: "discussion",
      status: "scheduled",
    },
    {
      title: "Friday Night DJ Set",
      topic: "R&B, gospel, and afrobeat — hosts rotate weekly.",
      type: "dj-set",
      status: "scheduled",
    },
  ];

  const spacesInserted: string[] = [];
  for (const s of demoSpaces) {
    const { data: existing } = await supabase
      .from("spaces")
      .select("id")
      .eq("title", s.title)
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    const { data: created, error } = await supabase
      .from("spaces")
      .insert({
        title: s.title,
        topic: s.topic,
        type: s.type,
        status: s.status,
        host_id: hostProfile.id,
      })
      .select("id, title")
      .single();
    if (!error && created) spacesInserted.push(created.title);
  }

  // Community welcome posts.
  const posts = [
    {
      body: "Welcome to Melori Community. This is where fans and artists connect between spaces. Drop a hello 👋",
    },
    {
      body: "Reminder: your Superfan membership unlocks posting in spaces, priority access to listening parties, and early drops.",
    },
    {
      body: "Artists — heads up: /dashboard is live. You can now submit tracks and see your streams in one place.",
    },
  ];

  const postsInserted: number[] = [];
  for (const p of posts) {
    const { data: existing } = await supabase
      .from("community_comments")
      .select("id")
      .eq("body", p.body)
      .limit(1)
      .maybeSingle();
    if (existing) continue;

    const { data: created, error } = await supabase
      .from("community_comments")
      .insert({
        body: p.body,
        author_name: hostName,
        user_id: hostProfile.id,
      })
      .select("id")
      .single();
    if (!error && created) postsInserted.push(created.id);
  }

  return NextResponse.json({
    ok: true,
    spacesInserted,
    postsInserted,
    hostProfileId: hostProfile.id,
  });
}
