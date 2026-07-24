// Server-only availability engine — Phase 4 of the photography module.
//
// Computes open booking slots for a single calendar day in the
// photographer's local timezone: weekly availability windows minus existing
// photo_bookings (pending/confirmed) minus (if connected) Google Calendar
// busy intervals. Google Calendar is OPTIONAL — getBusyIntervals already
// fails gracefully (returns []) when not configured/connected, so this file
// never special-cases "calendar missing" beyond calling it and using
// whatever it returns.

import { fromZonedTime, toZonedTime } from "date-fns-tz";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getBusyIntervals } from "@/lib/google-calendar";

export interface PhotographerSettings {
  photographerId: string;
  timezone: string;
  minNoticeHours: number;
  maxAdvanceDays: number;
  slotIntervalMinutes: number;
  bufferMinutes: number;
}

const DEFAULT_SETTINGS: Omit<PhotographerSettings, "photographerId"> = {
  timezone: "America/Chicago",
  minNoticeHours: 24,
  maxAdvanceDays: 90,
  slotIntervalMinutes: 30,
  bufferMinutes: 0,
};

export async function getPhotographerSettings(
  photographerId: string,
): Promise<PhotographerSettings> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("photographer_settings")
    .select(
      "timezone, min_notice_hours, max_advance_days, slot_interval_minutes, buffer_minutes",
    )
    .eq("photographer_id", photographerId)
    .maybeSingle();

  if (error || !data) {
    return { photographerId, ...DEFAULT_SETTINGS };
  }

  return {
    photographerId,
    timezone: (data.timezone as string) || DEFAULT_SETTINGS.timezone,
    minNoticeHours:
      typeof data.min_notice_hours === "number"
        ? data.min_notice_hours
        : DEFAULT_SETTINGS.minNoticeHours,
    maxAdvanceDays:
      typeof data.max_advance_days === "number"
        ? data.max_advance_days
        : DEFAULT_SETTINGS.maxAdvanceDays,
    slotIntervalMinutes:
      typeof data.slot_interval_minutes === "number"
        ? data.slot_interval_minutes
        : DEFAULT_SETTINGS.slotIntervalMinutes,
    bufferMinutes:
      typeof data.buffer_minutes === "number"
        ? data.buffer_minutes
        : DEFAULT_SETTINGS.bufferMinutes,
  };
}

export interface AvailabilityRule {
  id: string;
  weekday: number; // 0=Sun..6=Sat
  startMinute: number;
  endMinute: number;
  isActive: boolean;
}

export async function getWeeklyAvailability(
  photographerId: string,
): Promise<AvailabilityRule[]> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase
    .from("photo_availability")
    .select("id, weekday, start_minute, end_minute, is_active")
    .eq("photographer_id", photographerId)
    .order("weekday", { ascending: true })
    .order("start_minute", { ascending: true });

  if (error || !data) return [];

  return data.map((r) => ({
    id: r.id as string,
    weekday: r.weekday as number,
    startMinute: r.start_minute as number,
    endMinute: r.end_minute as number,
    isActive: r.is_active as boolean,
  }));
}

interface Interval {
  start: number; // epoch ms
  end: number;
}

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && a.end > b.start;
}

/**
 * Computes the list of candidate slot START times (as ISO strings, UTC) for
 * the given local calendar date ("YYYY-MM-DD") in the photographer's
 * timezone, for a service of `durationMinutes`. Subtracts existing bookings
 * and (if connected) Google Calendar busy time. Every candidate slot must
 * have room for the full service duration + buffer before the next busy
 * interval / window end.
 */
export async function computeAvailableSlots(opts: {
  photographerId: string;
  dateStr: string; // "YYYY-MM-DD" in the photographer's local timezone
  durationMinutes: number;
}): Promise<string[]> {
  const { photographerId, dateStr, durationMinutes } = opts;

  const settings = await getPhotographerSettings(photographerId);
  const tz = settings.timezone;

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return [];
  const [, yStr, mStr, dStr] = match;
  const year = Number(yStr);
  const month = Number(mStr);
  const day = Number(dStr);

  // Midnight of the requested date in the photographer's local timezone,
  // expressed as a UTC Date via fromZonedTime.
  const localMidnightUtc = fromZonedTime(
    new Date(year, month - 1, day, 0, 0, 0, 0),
    tz,
  );

  // Weekday (0=Sun..6=Sat) of the requested date IN THE PHOTOGRAPHER'S TZ —
  // derive it from the local wall-clock date we were given directly (the
  // date string already represents the local calendar day the client
  // picked), avoiding any UTC-conversion drift near midnight.
  const weekday = new Date(year, month - 1, day).getDay();

  const rules = (await getWeeklyAvailability(photographerId)).filter(
    (r) => r.isActive && r.weekday === weekday,
  );
  if (rules.length === 0) return [];

  const now = Date.now();
  const minNoticeMs = settings.minNoticeHours * 60 * 60 * 1000;
  const maxAdvanceMs = settings.maxAdvanceDays * 24 * 60 * 60 * 1000;
  const earliestAllowed = now + minNoticeMs;
  const latestAllowed = now + maxAdvanceMs;

  const serviceMs = durationMinutes * 60 * 1000;
  const bufferMs = settings.bufferMinutes * 60 * 1000;
  const stepMs = Math.max(settings.slotIntervalMinutes, 5) * 60 * 1000;

  // Load busy intervals for the whole day (bookings + calendar) once.
  const dayStartMs = localMidnightUtc.getTime();
  const dayEndMs = dayStartMs + 24 * 60 * 60 * 1000;

  const busy: Interval[] = await loadBusyIntervals(
    photographerId,
    new Date(dayStartMs).toISOString(),
    new Date(dayEndMs).toISOString(),
  );

  const slots: string[] = [];

  for (const rule of rules) {
    const windowStart = dayStartMs + rule.startMinute * 60 * 1000;
    const windowEnd = dayStartMs + rule.endMinute * 60 * 1000;

    const starts = generateSlotStarts({
      windowStart,
      windowEnd,
      serviceMs,
      bufferMs,
      stepMs,
      earliestAllowed,
      latestAllowed,
      busy,
    });
    for (const candidateStart of starts) {
      slots.push(new Date(candidateStart).toISOString());
    }
  }

  return slots;
}

/**
 * PURE slot-window generator (no I/O) — extracted so the boundary math can be
 * unit-tested deterministically (see scripts/booking-slots.test.ts).
 *
 * Returns candidate START times (epoch ms) that satisfy ALL of:
 *  - the FULL service duration fits before the window end:
 *    `candidateStart + serviceMs <= windowEnd` (this is why the last slot of a
 *    9-5 window for a 60-min service is 4:00pm, not 4:30pm),
 *  - the start honors min-notice / max-advance bounds,
 *  - the service + buffer does not overlap any busy interval.
 *
 * Keep this the single source of truth for slot-boundary behavior; changing
 * the loop condition here is what the boundary tests guard against.
 */
export function generateSlotStarts(opts: {
  windowStart: number;
  windowEnd: number;
  serviceMs: number;
  bufferMs: number;
  stepMs: number;
  earliestAllowed: number;
  latestAllowed: number;
  busy: Interval[];
}): number[] {
  const {
    windowStart,
    windowEnd,
    serviceMs,
    bufferMs,
    stepMs,
    earliestAllowed,
    latestAllowed,
    busy,
  } = opts;

  const out: number[] = [];
  const step = Math.max(stepMs, 5 * 60 * 1000);
  const windowMs = windowEnd - windowStart;

  // A service that is at least as long as the whole availability window can
  // only ever be booked by running right up to (or past) closing time — its
  // trailing buffer can never fit. For such services we do NOT enforce the
  // end-of-day buffer, otherwise a full-day booking (e.g. an 8-hour Wedding
  // in an 8-hour day) would be impossible to book at all. For every normal
  // service that is shorter than the window, the buffer IS enforced at end of
  // day so the last shoot also gets its reset gap before close.
  const enforceEndOfDayBuffer = bufferMs > 0 && serviceMs < windowMs;

  for (
    let candidateStart = windowStart;
    candidateStart + serviceMs <= windowEnd;
    candidateStart += step
  ) {
    const candidateEnd = candidateStart + serviceMs + bufferMs;

    if (candidateStart < earliestAllowed) continue;
    if (candidateStart > latestAllowed) continue;

    // End-of-day buffer: the shoot + its trailing buffer must fit before
    // closing (mirrors the between-shoots buffer in the busy-overlap check).
    if (enforceEndOfDayBuffer && candidateEnd > windowEnd) continue;

    const candidateInterval: Interval = {
      start: candidateStart,
      end: candidateEnd,
    };
    const conflict = busy.some((b) => overlaps(candidateInterval, b));
    if (conflict) continue;

    out.push(candidateStart);
  }

  return out;
}

/**
 * Loads busy intervals (epoch ms) for the given UTC window: existing
 * pending/confirmed photo_bookings + (if connected) Google Calendar busy
 * time. Calendar failures/absence never throw — getBusyIntervals already
 * degrades to [] gracefully.
 */
async function loadBusyIntervals(
  photographerId: string,
  timeMinIso: string,
  timeMaxIso: string,
): Promise<Interval[]> {
  const supabase = getSupabaseAdmin();
  const { data: bookings, error } = await supabase
    .from("photo_bookings")
    .select("starts_at, ends_at, status")
    .eq("photographer_id", photographerId)
    .in("status", ["pending", "confirmed"])
    .lt("starts_at", timeMaxIso)
    .gt("ends_at", timeMinIso);

  const bookingIntervals: Interval[] = error
    ? []
    : (bookings ?? []).map((b) => ({
        start: new Date(b.starts_at as string).getTime(),
        end: new Date(b.ends_at as string).getTime(),
      }));

  let calendarIntervals: Interval[] = [];
  try {
    const busy = await getBusyIntervals(photographerId, timeMinIso, timeMaxIso);
    calendarIntervals = busy.map((b) => ({
      start: new Date(b.start).getTime(),
      end: new Date(b.end).getTime(),
    }));
  } catch (err) {
    // getBusyIntervals should never throw, but stay defensive — a calendar
    // hiccup must never take down slot computation.
    console.warn("[booking-availability] getBusyIntervals threw", err);
    calendarIntervals = [];
  }

  return [...bookingIntervals, ...calendarIntervals];
}

/**
 * Re-validates that a specific candidate start time is still free for the
 * given service duration — used by /api/booking/create to never trust the
 * client's slot selection. Returns { free, endsAt } where endsAt is the ISO
 * end time if free.
 */
export async function isSlotStillFree(opts: {
  photographerId: string;
  startsAtIso: string;
  durationMinutes: number;
}): Promise<{ free: boolean; endsAtIso: string }> {
  const { photographerId, startsAtIso, durationMinutes } = opts;
  const settings = await getPhotographerSettings(photographerId);
  const startMs = new Date(startsAtIso).getTime();
  if (Number.isNaN(startMs)) return { free: false, endsAtIso: "" };

  const serviceMs = durationMinutes * 60 * 1000;
  const bufferMs = settings.bufferMinutes * 60 * 1000;
  const endMs = startMs + serviceMs;
  const endsAtIso = new Date(endMs).toISOString();

  const now = Date.now();
  if (startMs < now + settings.minNoticeHours * 60 * 60 * 1000) {
    return { free: false, endsAtIso };
  }
  if (startMs > now + settings.maxAdvanceDays * 24 * 60 * 60 * 1000) {
    return { free: false, endsAtIso };
  }

  // Confirm the slot falls within an active weekly window for its local
  // weekday in the photographer's timezone.
  const tz = settings.timezone;
  const localStart = toZonedTime(new Date(startMs), tz);
  const weekday = localStart.getDay();
  const localMinuteOfDay = localStart.getHours() * 60 + localStart.getMinutes();

  const rules = await getWeeklyAvailability(photographerId);
  const bufferMinutes = settings.bufferMinutes;
  const withinWindow = rules.some((r) => {
    if (!r.isActive || r.weekday !== weekday) return false;
    if (localMinuteOfDay < r.startMinute) return false;
    // The service itself must fit before close.
    if (localMinuteOfDay + durationMinutes > r.endMinute) return false;
    // End-of-day buffer: for services shorter than the whole window, the
    // trailing buffer must also fit before close — mirroring the slot
    // generator (generateSlotStarts) so the create path never accepts a slot
    // the /slots API would have hidden. Full-window services (service >=
    // window length) are exempt so full-day bookings remain possible.
    const windowLen = r.endMinute - r.startMinute;
    const enforceEndOfDayBuffer = bufferMinutes > 0 && durationMinutes < windowLen;
    if (
      enforceEndOfDayBuffer &&
      localMinuteOfDay + durationMinutes + bufferMinutes > r.endMinute
    ) {
      return false;
    }
    return true;
  });
  if (!withinWindow) return { free: false, endsAtIso };

  const busy = await loadBusyIntervals(
    photographerId,
    new Date(startMs - 24 * 60 * 60 * 1000).toISOString(),
    new Date(endMs + 24 * 60 * 60 * 1000).toISOString(),
  );
  const candidate: Interval = { start: startMs, end: endMs + bufferMs };
  const conflict = busy.some((b) => overlaps(candidate, b));

  return { free: !conflict, endsAtIso };
}
