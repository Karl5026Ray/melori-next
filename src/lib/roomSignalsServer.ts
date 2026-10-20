import "server-only";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// Server-side room notices over Supabase Realtime (replaces PubNub). They go to
// the read-only `room-sys:<spaceId>` channel, which only the service role can
// write (see migration 095_room_signals_realtime and roomSignalsClient.ts), so
// no participant can forge "space-ended". Delivered over REST,
// no socket needed. Best-effort: never throws into the caller, because the
// database row is always the source of truth.

async function send(spaceId: string, event: "system", payload: Record<string, unknown>) {
  const supabase = getSupabaseAdmin();
  const channel = supabase.channel(`room-sys:${spaceId}`, {
    config: { private: true },
  });
  try {
    await channel.httpSend(event, payload);
  } catch (err) {
    console.warn(`room ${event} signal failed`, (err as Error)?.message ?? err);
  } finally {
    // Never subscribed; drop it so a warm server instance doesn't collect one
    // channel object per notice.
    void supabase.removeChannel(channel).catch(() => undefined);
  }
}

// e.g. { event: "space-ended" } or { event: "host-changed", host_id }.
export async function publishSystemSignal(
  spaceId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await send(spaceId, "system", payload);
}
