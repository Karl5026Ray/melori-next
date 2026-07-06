import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { ensureArtistRow } from "@/lib/artist";
import {
  requireAdmin,
  isAdminGuardFailure,
  logAdminAction,
  generateTempPassword,
  ADMIN_ROLES,
  ADMIN_STATUSES,
  type AdminRole,
} from "@/lib/admin-panel";
import { trimOrNull } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pull emails + last_sign_in for a set of profile ids from auth.users via the
// admin API. auth.admin has no "get by id list", so we page listUsers and map.
async function buildAuthMap(
  supabase: ReturnType<typeof getSupabaseAdmin>,
): Promise<Map<string, { email: string | null; lastSignInAt: string | null }>> {
  const map = new Map<string, { email: string | null; lastSignInAt: string | null }>();
  let page = 1;
  const perPage = 1000;
  // Cap at a few pages so a huge user base can't stall the request.
  for (; page <= 10; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;
    for (const u of data.users) {
      map.set(u.id, {
        email: u.email ?? null,
        lastSignInAt: u.last_sign_in_at ?? null,
      });
    }
    if (data.users.length < perPage) break;
  }
  return map;
}

// GET /api/admin/accounts?role=&status=&q=&includeDeleted=
export async function GET(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  const url = req.nextUrl;
  const role = url.searchParams.get("role") ?? "all";
  const status = url.searchParams.get("status") ?? "all";
  const includeDeleted = url.searchParams.get("includeDeleted") === "true";
  const rawQ = (url.searchParams.get("q") ?? "").trim();
  // Strip PostgREST .or() control chars before splicing into the ilike filter.
  const q = rawQ.replace(/[,()\\%_"']/g, "").slice(0, 60);

  const supabase = getSupabaseAdmin();

  let query = supabase
    .from("profiles")
    .select(
      "id, username, display_name, full_name, avatar_url, role, membership_tier, membership_status, verified, status, suspended_reason, deleted_at, deleted_reason, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(500);

  if (ADMIN_ROLES.includes(role as AdminRole)) query = query.eq("role", role);

  if (ADMIN_STATUSES.includes(status as (typeof ADMIN_STATUSES)[number])) {
    query = query.eq("status", status);
  } else if (!includeDeleted) {
    // Default view hides soft-deleted accounts.
    query = query.neq("status", "deleted");
  }

  if (q) {
    query = query.or(
      `username.ilike.%${q}%,display_name.ilike.%${q}%,full_name.ilike.%${q}%`,
    );
  }

  const { data: profiles, error } = await query;
  if (error) {
    console.error("admin accounts list error:", error);
    return NextResponse.json({ error: "Failed to list accounts" }, { status: 500 });
  }

  const rows = profiles ?? [];
  const authMap = await buildAuthMap(supabase);

  // Link artist rows so the UI can show artist slug / verified state.
  const ids = rows.map((r) => r.id);
  const artistMap = new Map<string, { id: number; slug: string; is_verified: boolean; is_published: boolean }>();
  if (ids.length) {
    const { data: artists } = await supabase
      .from("artists")
      .select("id, slug, is_verified, is_published, profile_id")
      .in("profile_id", ids);
    for (const a of artists ?? []) {
      if (a.profile_id) {
        artistMap.set(a.profile_id as string, {
          id: a.id as number,
          slug: a.slug as string,
          is_verified: Boolean(a.is_verified),
          is_published: Boolean(a.is_published),
        });
      }
    }
  }

  let users = rows.map((r) => {
    const auth = authMap.get(r.id);
    return {
      ...r,
      email: auth?.email ?? null,
      last_sign_in_at: auth?.lastSignInAt ?? null,
      artist: artistMap.get(r.id) ?? null,
    };
  });

  // Email is only known after the auth map is built, so apply the search term
  // to email here (name columns were already filtered in SQL).
  if (q) {
    const needle = q.toLowerCase();
    users = users.filter(
      (u) =>
        (u.email ?? "").toLowerCase().includes(needle) ||
        (u.username ?? "").toLowerCase().includes(needle) ||
        (u.display_name ?? "").toLowerCase().includes(needle) ||
        (u.full_name ?? "").toLowerCase().includes(needle),
    );
  }

  // Stats cards (counts across all profiles, independent of current filter).
  const [totalRes, artistRes, activeRes, suspendedRes] = await Promise.all([
    supabase.from("profiles").select("id", { count: "exact", head: true }).neq("status", "deleted"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("role", "artist").neq("status", "deleted"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "active"),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("status", "suspended"),
  ]);

  return NextResponse.json({
    users,
    stats: {
      total: totalRes.count ?? 0,
      artists: artistRes.count ?? 0,
      active: activeRes.count ?? 0,
      suspended: suspendedRes.count ?? 0,
    },
  });
}

// POST /api/admin/accounts — create a new account.
// Body: { email, display_name?, username?, role? }
export async function POST(req: NextRequest) {
  const admin = await requireAdmin(req);
  if (isAdminGuardFailure(admin)) return admin;

  const body = await req.json().catch(() => ({}) as Record<string, unknown>);
  const email = trimOrNull(body.email)?.toLowerCase() ?? null;
  const displayName = trimOrNull(body.display_name);
  const username = trimOrNull(body.username);
  const roleRaw = trimOrNull(body.role) ?? "free";
  const role = (ADMIN_ROLES.includes(roleRaw as AdminRole) ? roleRaw : "free") as AdminRole;

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ error: "A valid email is required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const tempPassword = generateTempPassword();

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password: tempPassword,
    email_confirm: true,
    user_metadata: { display_name: displayName, username },
  });

  if (createErr || !created?.user) {
    const msg = createErr?.message ?? "Failed to create user";
    const status = /already|registered|exists/i.test(msg) ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }

  const userId = created.user.id;

  // A DB trigger may auto-insert a profiles row on signup, so upsert on the id
  // to update-or-insert rather than risk a duplicate.
  const { error: upsertErr } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userId,
        role,
        status: "active",
        display_name: displayName,
        username,
        full_name: displayName,
      },
      { onConflict: "id" },
    );

  if (upsertErr) {
    console.error("admin create profile upsert error:", upsertErr);
    return NextResponse.json({ error: "User created but profile setup failed" }, { status: 500 });
  }

  if (role === "artist") {
    await ensureArtistRow(userId, { displayName, username });
  }

  await logAdminAction(admin, {
    action: "create",
    targetType: role === "artist" ? "artist" : "user",
    targetId: userId,
    details: { email, role, display_name: displayName, username },
  });

  return NextResponse.json({
    ok: true,
    id: userId,
    email,
    role,
    tempPassword,
  });
}
