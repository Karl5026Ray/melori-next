"use client";

// Start a Cinema — Cinema's own hosting form.
//
// Cinema used to be created from /social/spaces/create?format=cinema: a fifth
// "Room Format" tile on a page headed "Start a Space". Choosing a watch party
// therefore meant starting a Space, which is exactly the binding this route
// removes. There is no format picker here, because Cinema IS the selection.
//
// The row it writes is still a `spaces` row with room_format='cinema'. Cinema
// deliberately keeps sharing the room engine — roles, ordered raise-hand queue,
// moderation, bans, the migration 054 camera slots, unified teardown — so this
// separation is about the product surface, not a second room backend.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/social/providers/AuthProvider";
import {
  useCanParticipate,
  UpgradePrompt,
} from "@/components/social/UpgradePrompt";
import { authFetch } from "@/lib/authClient";
import { ArrowLeft, Clapperboard } from "lucide-react";
import Link from "next/link";
import { CINEMA_GENRE_TABS, CINEMA_ROOM_FORMAT, roomHref } from "@/lib/cinema";

// The discover screen's filter tabs, minus "live now" — that tab carries a null
// slug because it means "don't filter", so it is not a genre a host can pick.
const GENRE_CHOICES = CINEMA_GENRE_TABS.filter((tab) => tab.slug !== null);

export default function CreateCinemaPage() {
  const router = useRouter();
  const { user, profileError } = useAuth();
  const canParticipate = useCanParticipate();

  const [title, setTitle] = useState("");
  // Genre is optional. Untagged rooms still show under the default "live now"
  // tab, so requiring it would only add friction to going live.
  const [genre, setGenre] = useState<string | null>(null);
  const [scheduleFor, setScheduleFor] = useState<"now" | "later">("now");
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 30 * 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      // Distinguish "profile fetch failed" from "genuinely signed out" so a
      // transient error doesn't look like a mysterious bounce to /social/auth.
      if (profileError) {
        setError("Couldn't load your profile. Please try again.");
        return;
      }
      router.push("/social/auth?next=/social/cinema/create");
      return;
    }

    setIsSubmitting(true);
    setError("");

    let scheduled_at: string | undefined;
    if (scheduleFor === "later") {
      const t = new Date(scheduledAt);
      if (Number.isNaN(t.getTime())) {
        setError("Pick a valid start time");
        setIsSubmitting(false);
        return;
      }
      scheduled_at = t.toISOString();
    }

    // Server independently enforces Superfan+ on this endpoint (403 otherwise).
    const res = await authFetch("/api/social/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        // `spaces.type` has its own CHECK constraint that predates room_format
        // and does not admit 'cinema'. A watch party is a listening room with a
        // screen, so it posts type='listening'; room_format is what actually
        // makes it Cinema. Without this split the insert fails
        // spaces_type_check.
        type: "listening",
        room_format: CINEMA_ROOM_FORMAT,
        genre,
        scheduled_at,
      }),
    });

    if (res.ok) {
      const { space } = await res.json();
      router.push(
        // A scheduled room has nothing to enter yet, so land back on Cinema
        // discover, where it now appears under STARTING SOON.
        scheduled_at
          ? "/social/cinema"
          : roomHref({ id: space.id, room_format: CINEMA_ROOM_FORMAT }),
      );
      return;
    }

    if (res.status === 403) {
      router.push("/membership");
      return;
    }

    const data = await res.json().catch(() => ({}));
    setError(data?.error ?? "Could not start the room. Please try again.");
    setIsSubmitting(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 pb-28 md:p-8 md:pb-8 animate-fade-in">
      <div className="mx-auto max-w-lg">
        <div className="mb-8 flex items-center gap-3">
          <Link
            href="/social/cinema"
            aria-label="Back to Cinema"
            className="rounded-lg p-2 transition hover:bg-cinema-surface"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Clapperboard className="h-6 w-6 text-cinema-gold" />
          <h1 className="text-2xl font-bold">Start a Cinema</h1>
        </div>

        {user && !canParticipate ? (
          <UpgradePrompt action="start a Cinema room" />
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="cinema-title"
                className="mb-2 block text-sm text-melori-muted"
              >
                Room Title
              </label>
              <input
                id="cinema-title"
                type="text"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g., Friday Night Video Premiere"
                className="w-full rounded-xl border border-cinema-border bg-cinema-surface px-4 py-3 text-sm transition focus:border-cinema-gold focus:outline-none"
              />
            </div>

            <div>
              <span className="mb-3 block text-sm text-melori-muted">
                Genre <span className="text-melori-muted/60">(optional)</span>
              </span>
              <div className="flex flex-wrap gap-2">
                {GENRE_CHOICES.map((choice) => {
                  const selected = genre === choice.slug;
                  return (
                    <button
                      key={choice.slug}
                      type="button"
                      aria-pressed={selected}
                      // Tapping the selected chip clears it, so a host can get
                      // back to untagged without reloading the form.
                      onClick={() =>
                        setGenre(selected ? null : (choice.slug as string))
                      }
                      className={`rounded-full border px-3.5 py-2 text-xs font-medium transition ${
                        selected
                          ? "border-cinema-gold bg-cinema-gold/15 text-cinema-gold"
                          : "border-cinema-border text-white/60 hover:border-cinema-gold/40"
                      }`}
                    >
                      {choice.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-melori-muted">
                Tags your room on the Cinema screen. Untagged rooms still appear
                under &ldquo;live now&rdquo;.
              </p>
            </div>

            <div>
              <span className="mb-3 block text-sm text-melori-muted">When</span>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setScheduleFor("now")}
                  className={`rounded-xl border p-4 text-left transition ${
                    scheduleFor === "now"
                      ? "border-cinema-gold bg-cinema-gold/10"
                      : "border-cinema-border hover:border-cinema-gold/30"
                  }`}
                >
                  <p className="text-sm font-medium">Go live now</p>
                  <p className="mt-1 text-xs text-melori-muted">
                    Open the screen immediately
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setScheduleFor("later")}
                  className={`rounded-xl border p-4 text-left transition ${
                    scheduleFor === "later"
                      ? "border-cinema-gold bg-cinema-gold/10"
                      : "border-cinema-border hover:border-cinema-gold/30"
                  }`}
                >
                  <p className="text-sm font-medium">Schedule for later</p>
                  <p className="mt-1 text-xs text-melori-muted">
                    Announce a start time
                  </p>
                </button>
              </div>
              {scheduleFor === "later" && (
                <input
                  type="datetime-local"
                  aria-label="Start time"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="mt-3 w-full rounded-xl border border-cinema-border bg-cinema-surface px-4 py-3 text-sm transition focus:border-cinema-gold focus:outline-none"
                />
              )}
            </div>

            <p className="rounded-xl border border-cinema-border bg-cinema-surface/60 p-3 text-xs text-melori-muted">
              You host the shared screen and pick what plays. Two guests can join
              you on camera; everyone else watches and comments.
            </p>

            {error && (
              <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="btn-primary w-full rounded-xl py-3.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting
                ? scheduleFor === "later"
                  ? "Scheduling..."
                  : "Opening..."
                : scheduleFor === "later"
                  ? "Schedule Cinema"
                  : "Go Live"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
