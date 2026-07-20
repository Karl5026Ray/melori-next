"use client";

import { useCallback, useEffect, useState } from "react";
import { CalendarDays, Loader2, Save } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import type { AvailabilityRule } from "./types";

const WEEKDAYS = [
  { value: 0, label: "Sunday" },
  { value: 1, label: "Monday" },
  { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" },
  { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" },
  { value: 6, label: "Saturday" },
];

function minutesToTimeInput(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const m = (minutes % 60).toString().padStart(2, "0");
  return `${h}:${m}`;
}

function timeInputToMinutes(value: string): number {
  const [h, m] = value.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

// One weekly window per weekday (simplest model — Karl can toggle a day on
// and set a single start/end window; multiple windows per day aren't needed
// for a single-photographer setup, but the underlying rules[] supports it if
// he ever wants to add a second row via the API directly).
interface DayRow {
  weekday: number;
  isActive: boolean;
  startMinute: number;
  endMinute: number;
  ruleId?: string;
}

const DEFAULT_ROWS: DayRow[] = WEEKDAYS.map((d) => ({
  weekday: d.value,
  isActive: false,
  startMinute: 9 * 60,
  endMinute: 17 * 60,
}));

export default function WeeklyAvailabilityEditor() {
  const [rows, setRows] = useState<DayRow[]>(DEFAULT_ROWS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/studio/availability", { method: "GET" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load availability.");
      const rules: AvailabilityRule[] = body.rules ?? [];
      setRows(
        WEEKDAYS.map((d) => {
          const existing = rules.find((r) => r.weekday === d.value);
          return existing
            ? {
                weekday: d.value,
                isActive: existing.isActive,
                startMinute: existing.startMinute,
                endMinute: existing.endMinute,
                ruleId: existing.id,
              }
            : { weekday: d.value, isActive: false, startMinute: 9 * 60, endMinute: 17 * 60 };
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load availability.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const updateRow = (weekday: number, patch: Partial<DayRow>) => {
    setRows((prev) => prev.map((r) => (r.weekday === weekday ? { ...r, ...patch } : r)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const invalid = rows.some(
        (r) => r.isActive && r.startMinute >= r.endMinute,
      );
      if (invalid) {
        throw new Error("End time must be after start time for active days.");
      }
      const payload = rows
        .filter((r) => r.isActive)
        .map((r) => ({
          weekday: r.weekday,
          startMinute: r.startMinute,
          endMinute: r.endMinute,
          isActive: true,
        }));
      const res = await authFetch("/api/studio/availability", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rules: payload }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save availability.");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save availability.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-brand-border bg-brand-surface p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-muted text-brand-primary shrink-0">
          <CalendarDays className="h-5 w-5" />
        </span>
        <div>
          <p className="font-semibold text-sm">Weekly availability</p>
          <p className="text-xs text-text-secondary">
            Turn on the days you shoot and set your working hours.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-text-secondary">Loading…</p>
      ) : (
        <div className="mt-4 space-y-2">
          {WEEKDAYS.map((d) => {
            const row = rows.find((r) => r.weekday === d.value)!;
            return (
              <div
                key={d.value}
                className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-border bg-black/20 p-3"
              >
                <label className="flex items-center gap-2 w-24 shrink-0">
                  <input
                    type="checkbox"
                    checked={row.isActive}
                    onChange={(e) => updateRow(d.value, { isActive: e.target.checked })}
                    className="h-4 w-4 accent-[#ff5500]"
                  />
                  <span className="text-sm font-medium">{d.label}</span>
                </label>
                <input
                  type="time"
                  value={minutesToTimeInput(row.startMinute)}
                  disabled={!row.isActive}
                  onChange={(e) =>
                    updateRow(d.value, { startMinute: timeInputToMinutes(e.target.value) })
                  }
                  className="rounded-lg border border-input-border bg-black/40 px-2 py-1.5 text-sm disabled:opacity-40"
                />
                <span className="text-xs text-text-secondary">to</span>
                <input
                  type="time"
                  value={minutesToTimeInput(row.endMinute)}
                  disabled={!row.isActive}
                  onChange={(e) =>
                    updateRow(d.value, { endMinute: timeInputToMinutes(e.target.value) })
                  }
                  className="rounded-lg border border-input-border bg-black/40 px-2 py-1.5 text-sm disabled:opacity-40"
                />
              </div>
            );
          })}
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-400">
          {error}
        </p>
      )}
      {saved && (
        <p className="mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-xs text-emerald-400">
          Availability saved.
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || loading}
        className="mt-4 flex items-center justify-center gap-2 rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-2.5 px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save availability
      </button>
    </div>
  );
}
