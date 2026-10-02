// src/lib/spaceReminders.ts
//
// When does a "remind me" on a room turn into an email? Pure, so the cron and
// its test share one rule.
//
//   live now                        -> "live"  (room is open, come in)
//   scheduled, starts within LEAD    -> "soon"  (starts in a few minutes)
//   scheduled, further out           -> "wait"  (check again next run)
//   ended / cancelled                -> "skip"  (stamp it, never email)
//   scheduled but STALE_AFTER late   -> "skip"  (host never went live)
//
// Before 2 Oct 2026 nothing sent these at all: people tapped the bell on an
// upcoming room and were never told it started.

export const REMINDER_LEAD_MS = 10 * 60 * 1000;
export const REMINDER_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export type ReminderAction = "live" | "soon" | "wait" | "skip";

export function reminderAction(input: {
  status: string | null | undefined;
  scheduledAt: string | null | undefined;
  endedAt: string | null | undefined;
  now: number;
}): ReminderAction {
  if (input.endedAt || input.status === "ended") return "skip";
  if (input.status === "live") return "live";
  if (input.status !== "scheduled") return "skip";
  const at = input.scheduledAt ? Date.parse(input.scheduledAt) : NaN;
  if (!Number.isFinite(at)) return "wait";
  if (input.now - at > REMINDER_STALE_AFTER_MS) return "skip";
  if (at - input.now <= REMINDER_LEAD_MS) return "soon";
  return "wait";
}
