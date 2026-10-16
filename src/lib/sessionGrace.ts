// Did a LiveKit participant really leave, or is it reconnecting?
//
// THE BUG (14 Oct 2026, Karl in a Cinema room): a listener raised a hand, the
// host brought them up, and the listener was thrown out of the room.
//
// A role change reconnects on purpose. The room screen's LiveKit effect depends
// on the participant's role, so promotion runs its cleanup (disconnect the
// listener session), then joins again with a publisher token. The OLD session
// is gone before the NEW one exists. LiveKit reports participant_left for the
// old session, the webhook asks "is this person back under another session?",
// gets "no" because the new one is still fetching its token, and marks them
// left and demoted. The client then reads itself off the roster and drops out.
//
// isSupersededSession was the right check made too early. This waits a short
// grace window and asks again, so a planned reconnect is recognised while a
// real drop is still recorded, a few seconds late.

export const RECONNECT_GRACE_MS = 8_000;
export const RECONNECT_POLL_MS = 1_000;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * True when the departed session was NOT replaced within the grace window,
 * i.e. the person really left. False as soon as a newer session is seen.
 */
export async function departedForGood(
  isSuperseded: () => Promise<boolean>,
  {
    graceMs = RECONNECT_GRACE_MS,
    pollMs = RECONNECT_POLL_MS,
    sleep = defaultSleep,
  }: { graceMs?: number; pollMs?: number; sleep?: (ms: number) => Promise<void> } = {},
): Promise<boolean> {
  if (await isSuperseded()) return false;
  for (let waited = 0; waited < graceMs; waited += pollMs) {
    await sleep(pollMs);
    if (await isSuperseded()) return false;
  }
  return true;
}
