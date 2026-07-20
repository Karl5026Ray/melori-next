"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Save, Settings } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import type { PhotographerSettings } from "./types";

const COMMON_TIMEZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Denver",
  "America/Los_Angeles",
  "America/Phoenix",
  "America/Anchorage",
  "Pacific/Honolulu",
  "UTC",
];

const DEFAULTS: PhotographerSettings = {
  timezone: "America/Chicago",
  min_notice_hours: 24,
  max_advance_days: 90,
  slot_interval_minutes: 30,
  buffer_minutes: 0,
  updated_at: null,
};

export default function SettingsPanel() {
  const [settings, setSettings] = useState<PhotographerSettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch("/api/studio/settings", { method: "GET" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load settings.");
      setSettings({ ...DEFAULTS, ...body.settings });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await authFetch("/api/studio/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          timezone: settings.timezone,
          minNoticeHours: settings.min_notice_hours,
          maxAdvanceDays: settings.max_advance_days,
          slotIntervalMinutes: settings.slot_interval_minutes,
          bufferMinutes: settings.buffer_minutes,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not save settings.");
      setSettings({ ...DEFAULTS, ...body.settings });
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-brand-border bg-brand-surface p-4 sm:p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-muted text-brand-primary shrink-0">
          <Settings className="h-5 w-5" />
        </span>
        <div>
          <p className="font-semibold text-sm">Booking settings</p>
          <p className="text-xs text-text-secondary">
            Timezone, lead time, and how far ahead clients can book.
          </p>
        </div>
      </div>

      {loading ? (
        <p className="mt-4 text-sm text-text-secondary">Loading…</p>
      ) : (
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
              Timezone
            </label>
            <select
              value={settings.timezone}
              onChange={(e) => setSettings((s) => ({ ...s, timezone: e.target.value }))}
              className="w-full rounded-lg border border-input-border bg-black/40 px-3 py-2 text-sm"
            >
              {!COMMON_TIMEZONES.includes(settings.timezone) && (
                <option value={settings.timezone}>{settings.timezone}</option>
              )}
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
              Minimum notice (hours)
            </label>
            <input
              type="number"
              min={0}
              value={settings.min_notice_hours}
              onChange={(e) =>
                setSettings((s) => ({ ...s, min_notice_hours: Number(e.target.value) || 0 }))
              }
              className="w-full rounded-lg border border-input-border bg-black/40 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
              Max advance booking (days)
            </label>
            <input
              type="number"
              min={1}
              value={settings.max_advance_days}
              onChange={(e) =>
                setSettings((s) => ({ ...s, max_advance_days: Number(e.target.value) || 1 }))
              }
              className="w-full rounded-lg border border-input-border bg-black/40 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
              Slot interval (minutes)
            </label>
            <input
              type="number"
              min={5}
              step={5}
              value={settings.slot_interval_minutes}
              onChange={(e) =>
                setSettings((s) => ({
                  ...s,
                  slot_interval_minutes: Number(e.target.value) || 5,
                }))
              }
              className="w-full rounded-lg border border-input-border bg-black/40 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wide text-text-secondary mb-1">
              Buffer between shoots (minutes)
            </label>
            <input
              type="number"
              min={0}
              step={5}
              value={settings.buffer_minutes}
              onChange={(e) =>
                setSettings((s) => ({ ...s, buffer_minutes: Number(e.target.value) || 0 }))
              }
              className="w-full rounded-lg border border-input-border bg-black/40 px-3 py-2 text-sm"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-3 rounded-lg bg-red-500/10 border border-red-500/20 p-2.5 text-xs text-red-400">
          {error}
        </p>
      )}
      {saved && (
        <p className="mt-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-2.5 text-xs text-emerald-400">
          Settings saved.
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving || loading}
        className="mt-4 flex items-center justify-center gap-2 rounded-full bg-brand-primary hover:bg-brand-primary-dark transition-colors py-2.5 px-5 text-sm font-semibold text-white disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        Save settings
      </button>
    </div>
  );
}
