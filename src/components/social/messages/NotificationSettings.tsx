"use client";

import { Bell, BellOff } from "lucide-react";
import {
  NOTIFICATION_LABELS,
  playNotificationSound,
  useNotificationPreferences,
  type NotificationSound,
} from "@/lib/notifications";

// Per-category sound toggles. Rendered inline where mounted (currently the top
// of Messages); every toggle previews the sound so users can hear what they
// just enabled without waiting for the real event to fire.
export function NotificationSettings() {
  const [prefs, setPrefs] = useNotificationPreferences();
  const anyOn = Object.values(prefs).some(Boolean);

  const toggle = (sound: NotificationSound) => {
    const next = { ...prefs, [sound]: !prefs[sound] };
    setPrefs(next);
    // Preview the sound we just turned ON — turning OFF is silent.
    if (next[sound]) playNotificationSound(sound, next);
  };

  const setAll = (on: boolean) => {
    setPrefs({ message: on, phoneCall: on, videoCall: on, onlineNow: on });
  };

  return (
    <div className="rounded-2xl border border-melori-border bg-melori-elevated/40 p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {anyOn ? (
            <Bell className="h-4 w-4 text-brand-primary" aria-hidden />
          ) : (
            <BellOff className="h-4 w-4 text-melori-muted" aria-hidden />
          )}
          <h3 className="text-sm font-semibold text-white">
            Notification sounds
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setAll(!anyOn)}
          className="text-xs font-semibold text-melori-muted transition-colors hover:text-brand-primary"
        >
          {anyOn ? "Mute all" : "Turn all on"}
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {(Object.keys(NOTIFICATION_LABELS) as NotificationSound[]).map(
          (sound) => {
            const on = prefs[sound];
            return (
              <button
                key={sound}
                type="button"
                onClick={() => toggle(sound)}
                aria-pressed={on}
                className={`flex items-center justify-between gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                  on
                    ? "border-brand-primary/40 bg-brand-primary/10 text-white"
                    : "border-melori-border bg-transparent text-melori-muted hover:border-melori-muted"
                }`}
              >
                <span className="font-medium">
                  {NOTIFICATION_LABELS[sound]}
                </span>
                <span
                  aria-hidden
                  className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                    on ? "bg-brand-primary" : "bg-melori-border"
                  }`}
                >
                  <span
                    className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                      on ? "left-4" : "left-0.5"
                    }`}
                  />
                </span>
              </button>
            );
          },
        )}
      </div>
    </div>
  );
}
