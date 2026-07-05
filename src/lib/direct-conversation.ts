// Shared helper for locating (or opening) a true 1:1 direct conversation
// between two users. Previously the waves-accept flow and the
// /conversations/start endpoint both looked for "any conversation both users
// belong to" — which happily returned an existing GROUP conversation with 5+
// members whenever both users happened to be in it. Accepting a wave then
// mis-routed the invitee into a totally unrelated group chat.
//
// A true 1:1 must contain *exactly* those two users and nobody else. This
// helper finds one, or opens a new one, atomically enough for our needs
// (accidental duplicate 1:1s are harmless — they collapse on the next find).
//
// This intentionally runs with the service-role client so it can bypass RLS
// on conversation_members. Callers are always responsible for their own
// permission checks (block list, membership tier, wave ownership, etc.).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ServiceClient = any;

export async function findOrCreateDirectConversation(
  supabase: ServiceClient,
  userA: string,
  userB: string,
): Promise<{ id: string; created: boolean } | { error: string }> {
  if (!userA || !userB || userA === userB) {
    return { error: "Both distinct user ids are required" };
  }

  // Candidate conversations = every conversation userA is a member of.
  const { data: myRows, error: myErr } = await supabase
    .from("conversation_members")
    .select("conversation_id")
    .eq("user_id", userA);
  if (myErr) return { error: myErr.message };
  const myIds = (myRows ?? []).map(
    (r: { conversation_id: string }) => r.conversation_id,
  );

  if (myIds.length > 0) {
    // Of those, keep the ones userB is also in.
    const { data: shared, error: sharedErr } = await supabase
      .from("conversation_members")
      .select("conversation_id")
      .eq("user_id", userB)
      .in("conversation_id", myIds);
    if (sharedErr) return { error: sharedErr.message };
    const sharedIds = (shared ?? []).map(
      (r: { conversation_id: string }) => r.conversation_id,
    );

    // Of those, keep only conversations that have EXACTLY two members total.
    // Otherwise we'd hand back a group chat as if it were the 1:1.
    for (const convId of sharedIds) {
      const { count } = await supabase
        .from("conversation_members")
        .select("*", { count: "exact", head: true })
        .eq("conversation_id", convId);
      if (count === 2) {
        return { id: convId, created: false };
      }
    }
  }

  // Nothing found — open a fresh 1:1.
  const { data: convo, error: convoErr } = await supabase
    .from("conversations")
    .insert({})
    .select("id")
    .single();
  if (convoErr || !convo) {
    return { error: convoErr?.message ?? "Failed to open conversation" };
  }
  const conversationId = convo.id as string;

  const { error: memErr } = await supabase.from("conversation_members").insert([
    { conversation_id: conversationId, user_id: userA },
    { conversation_id: conversationId, user_id: userB },
  ]);
  if (memErr) {
    return { error: memErr.message };
  }

  return { id: conversationId, created: true };
}
