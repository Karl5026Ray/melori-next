import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/studio/humanize/[jobId] — polling fallback to Supabase Realtime.
// Returns the caller's own humanize_jobs row (ownership enforced in
// application code since this route uses the service-role client).
export async function GET(req: NextRequest, props: { params: Promise<{ jobId: string }> }) {
  const params = await props.params;
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const userId = guard.membership.userId!;
  const jobId = params.jobId;
  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const { data: job, error } = await supabase
      .from("humanize_jobs")
      .select(
        "id, user_id, status, preset, forensic, forensic_intensity, blend, stems, master_path, error, created_at, updated_at",
      )
      .eq("id", jobId)
      .maybeSingle();

    if (error || !job) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    // 404 (not 403) so a stray jobId can't be used to probe existence.
    if (job.user_id !== userId) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ job });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Humanize job status error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
