import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { recordingsBucket } from "@/lib/mirrorRecording";
import { recordingConfigured, stopRoomRecording, waitForEgressEnd } from "@/lib/livekitServer";

// Audition takes are deleted when the session ends (Karl, 11 Oct). Shared by
// the director's End and the cleanup cron, so both delete the same way.
//
// Order matters: a running egress is still writing the MP4, so stop it and wait
// (bounded) for it to finish before deleting the object, or the upload lands
// after the delete and the file survives. Rows are removed only for objects
// that were actually removed, so a failed storage delete is retried by the
// next cron run instead of being forgotten.
export async function deleteSessionRecordings(spaceId: string): Promise<{
  deleted: number;
  pending: number;
}> {
  const supabase = getSupabaseAdmin();
  const { data: takes, error } = await supabase
    .from("audition_recordings")
    .select("id, egress_id, storage_key, stopped_at")
    .eq("space_id", spaceId);
  if (error || !takes?.length) return { deleted: 0, pending: 0 };

  if (recordingConfigured()) {
    for (const take of takes) {
      if (!take.stopped_at) await stopRoomRecording(take.egress_id);
    }
    const finished = await Promise.all(takes.map((t) => waitForEgressEnd(t.egress_id)));
    if (finished.some((ok) => !ok)) {
      // Still uploading: leave it for the next cron run.
      return { deleted: 0, pending: takes.length };
    }
  }

  const keys = takes.map((t) => t.storage_key);
  const { error: rmErr } = await supabase.storage.from(recordingsBucket()).remove(keys);
  if (rmErr) {
    console.error("[auditions] recording delete failed", spaceId, rmErr.message);
    return { deleted: 0, pending: takes.length };
  }
  await supabase.from("audition_recordings").delete().eq("space_id", spaceId);
  await supabase
    .from("spaces")
    .update({ is_recording: false, recording_egress_id: null, recording_storage_key: null })
    .eq("id", spaceId);
  return { deleted: takes.length, pending: 0 };
}

// Scripts, headshots and resumes follow the same rule as takes (Karl, 11 Oct:
// "I don't want to have to pay for someone else's stuff"): nothing a session
// uploaded outlives it. Reel links cost nothing but go with their rows.
export async function deleteSessionFiles(spaceId: string): Promise<number> {
  const supabase = getSupabaseAdmin();
  const { data: files } = await supabase
    .from("audition_files")
    .select("id, storage_path")
    .eq("space_id", spaceId);
  if (!files?.length) return 0;
  const paths = files.map((f) => f.storage_path).filter((p): p is string => Boolean(p));
  if (paths.length) {
    const { error } = await supabase.storage.from("audition-docs").remove(paths);
    if (error) {
      console.error("[auditions] file delete failed", spaceId, error.message);
      return 0; // rows kept, so the cron retries
    }
  }
  await supabase.from("audition_files").delete().eq("space_id", spaceId);
  return files.length;
}
