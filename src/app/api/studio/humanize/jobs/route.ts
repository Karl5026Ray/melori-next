import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/studio/humanize/jobs — the caller's own humanize jobs, newest
// first. Powers the persistent "My Humanized Tracks" library so a finished
// master + stems can be re-downloaded any time, not just in the session that
// created the job. Ownership is enforced in application code (service-role
// client) the same way as the [jobId] status route.
//
// Query: ?status=completed (default) | all   ·   ?limit=50 (max 200)
export async function GET(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const userId = guard.membership.userId!;
  const statusParam = (req.nextUrl.searchParams.get("status") || "completed").toLowerCase();
  const limitParam = parseInt(req.nextUrl.searchParams.get("limit") || "50", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1), 200);

  try {
    const supabase = getSupabaseAdmin();
    let query = supabase
      .from("humanize_jobs")
      .select(
        "id, user_id, status, preset, forensic, forensic_intensity, blend, stems, master_path, error, created_at, updated_at",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (statusParam !== "all") {
      query = query.eq("status", statusParam);
    }

    const { data: jobs, error } = await query;
    if (error) {
      console.error("Humanize jobs list error:", error);
      return NextResponse.json({ error: "Failed to load jobs" }, { status: 500 });
    }

    return NextResponse.json({ jobs: jobs ?? [] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Humanize jobs list error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
