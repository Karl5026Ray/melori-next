import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/studio/humanize — create a humanize_jobs row for stems the
// caller already uploaded via /api/studio/humanize/upload-urls, then fire a
// best-effort trigger at the Python humanizer service. The service does the
// actual (slow) work out-of-band and writes progress back onto the job row
// with the service-role key; this route never blocks on that.
//
// Body: { jobId, stems: [{ name, path }], preset, forensic, forensicIntensity, blend }

const VALID_PRESETS = new Set(["subtle", "natural", "loose", "vintage"]);
const VALID_INTENSITIES = new Set(["light", "medium", "heavy"]);
const MAX_STEMS = 15;
const TRIGGER_TIMEOUT_MS = 4000;

interface StemInput {
  name: string;
  path: string;
}

export async function POST(req: NextRequest) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;

  const userId = guard.membership.userId!;
  const body = await req.json().catch(() => ({}) as Record<string, unknown>);

  const jobId = typeof body.jobId === "string" ? body.jobId : null;
  const rawStems = Array.isArray(body.stems) ? (body.stems as unknown[]) : [];
  const preset =
    typeof body.preset === "string" && VALID_PRESETS.has(body.preset)
      ? body.preset
      : "natural";
  const forensicRequested = body.forensic === true;
  const forensicIntensity =
    typeof body.forensicIntensity === "string" &&
    VALID_INTENSITIES.has(body.forensicIntensity)
      ? body.forensicIntensity
      : "medium";
  const blend = body.blend !== false;

  if (!jobId) {
    return NextResponse.json({ error: "jobId is required" }, { status: 400 });
  }
  if (rawStems.length === 0) {
    return NextResponse.json(
      { error: "stems is required and must be a non-empty array" },
      { status: 400 },
    );
  }
  if (rawStems.length > MAX_STEMS) {
    return NextResponse.json(
      { error: `A maximum of ${MAX_STEMS} stems is supported` },
      { status: 400 },
    );
  }

  const stems: StemInput[] = [];
  for (const entry of rawStems) {
    if (
      !entry ||
      typeof entry !== "object" ||
      typeof (entry as { name?: unknown }).name !== "string" ||
      typeof (entry as { path?: unknown }).path !== "string"
    ) {
      return NextResponse.json(
        { error: "Each stem requires name and path" },
        { status: 400 },
      );
    }
    const name = (entry as { name: string }).name;
    const path = (entry as { path: string }).path;
    // Defense-in-depth: every stem path must live under this caller's own
    // job folder — the upload-urls route only ever mints paths there, but a
    // tampered client payload shouldn't be able to reference someone else's
    // stem.
    if (!path.startsWith(`humanize/${userId}/`)) {
      return NextResponse.json(
        { error: "Stem path is not owned by the caller" },
        { status: 403 },
      );
    }
    stems.push({ name, path });
  }

  try {
    const supabase = getSupabaseAdmin();

    // Forensic resistance is only ever honored server-side if the caller has
    // an explicit grant — the client-sent `forensic` flag alone is never
    // trusted.
    let forensicAllowed = false;
    if (forensicRequested) {
      const { data: accessRow } = await supabase
        .from("humanizer_access")
        .select("can_forensic")
        .eq("user_id", userId)
        .maybeSingle();
      forensicAllowed = accessRow?.can_forensic === true;
    }
    const forensic = forensicRequested && forensicAllowed;

    const stemsJson = stems.map((s) => ({
      name: s.name,
      inPath: s.path,
      status: "pending" as const,
      outPath: null,
      detection: null,
    }));

    const { data: job, error: insertError } = await supabase
      .from("humanize_jobs")
      .insert({
        id: jobId,
        user_id: userId,
        status: "pending",
        preset,
        forensic,
        forensic_intensity: forensicIntensity,
        blend,
        stems: stemsJson,
      })
      .select("id")
      .single();

    if (insertError || !job) {
      console.error("Humanize job insert error:", insertError);
      return NextResponse.json(
        { error: "Failed to create humanize job" },
        { status: 500 },
      );
    }

    // Fire-and-forget trigger to the Python service. We deliberately do NOT
    // await the full run — the worker processes stems asynchronously and
    // writes status back to humanize_jobs itself. A short timeout keeps this
    // route fast even if the service is slow to accept the request; any
    // failure here just means the client's realtime/poll never sees progress
    // start, which the UI surfaces the same way a stalled 'pending' job would.
    const serviceUrl = process.env.HUMANIZER_SERVICE_URL;
    const serviceToken = process.env.HUMANIZER_TOKEN;
    if (serviceUrl && serviceToken) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), TRIGGER_TIMEOUT_MS);
      fetch(`${serviceUrl.replace(/\/$/, "")}/humanize-job`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Melori-Token": serviceToken,
        },
        body: JSON.stringify({
          jobId,
          userId,
          stems,
          preset,
          forensic,
          forensicIntensity,
          blend,
          storage: { bucket: "humanizer-stems" },
        }),
        signal: controller.signal,
      })
        .catch((err) => {
          console.error("Humanizer service trigger failed:", err);
        })
        .finally(() => clearTimeout(timeout));
    } else {
      console.error(
        "HUMANIZER_SERVICE_URL / HUMANIZER_TOKEN not configured — job created but not triggered",
      );
    }

    return NextResponse.json({ jobId });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("Humanize job create error:", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
