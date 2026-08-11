/**
 * Small server-route helpers for the PR 2 Concert invitation surface.
 * They deliberately map known domain errors rather than exposing database text
 * to the browser, while unexpected service failures remain observable.
 */

export function concertBattleErrorResponse(
  message: string | null | undefined,
): { error: string; status: number } {
  const code = message ?? "";
  const known: Record<string, { error: string; status: number }> = {
    concert_battle_not_found: { error: "Concert battle not found.", status: 404 },
    concert_battle_initiator_required: {
      error: "Only the Concert initiator can do that.",
      status: 403,
    },
    concert_battle_invite_recipient_required: {
      error: "This invitation is not for you.",
      status: 403,
    },
    concert_battle_self_invite: { error: "You cannot invite yourself.", status: 400 },
    concert_battle_recipient_not_found: { error: "Member not found.", status: 404 },
    concert_battle_recipient_inactive: {
      error: "This member is not available for Concert invitations.",
      status: 409,
    },
    concert_battle_recipient_blocked: {
      error: "Invitations are unavailable between these members.",
      status: 403,
    },
    concert_battle_recipient_banned: {
      error: "This member cannot join this Concert.",
      status: 403,
    },
    concert_battle_opponent_locked: {
      error: "This Concert already has an opponent.",
      status: 409,
    },
    concert_battle_invite_pending: {
      error: "Cancel the pending invitation before choosing another opponent.",
      status: 409,
    },
    concert_battle_invite_expired: {
      error: "This invitation has expired.",
      status: 409,
    },
    concert_battle_invite_not_found: { error: "Invitation not found.", status: 404 },
    concert_battle_invite_not_pending: {
      error: "This invitation is no longer pending.",
      status: 409,
    },
    concert_battle_invite_action_invalid: { error: "Invalid invitation action.", status: 400 },
    concert_battle_title_invalid: { error: "Enter a Concert title of 200 characters or fewer.", status: 400 },
    concert_battle_topic_invalid: { error: "Topic must be 500 characters or fewer.", status: 400 },
  };
  return known[code] ?? { error: "Concert invitation could not be completed.", status: 500 };
}
