"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/social/providers/AuthProvider";
import {
  useCanParticipate,
  SignInPrompt,
} from "@/components/social/SignInPrompt";
import { authFetch } from "@/lib/authClient";
import {
  ArrowLeft,
  Headphones,
  MessageCircle,
  Radio,
} from "lucide-react";
import Link from "next/link";
import { roomExitHref, roomHref, roomScheduledHref } from "@/lib/cinema";

// `id` drives the UI selection AND is posted as the room's `type`. Those are
// two different vocabularies: `spaces.type` has its own CHECK constraint
// (listening | discussion | creation | dj_set) that predates room_format, so
// the UI id and the posted type are kept separate here.
//
// Cinema is deliberately NOT in this list. It used to be a fifth tile, which
// meant hosting a watch party started on a form titled "Start a Space" and made
// Cinema look like a Spaces variant. Cinema is its own selection and now has
// its own form at /social/cinema/create — see roomCreateHref() in lib/cinema.
const spaceTypes: {
  id: string;
  spaceType: "listening" | "discussion" | "dj_set";
  format: "release_party" | "discussion" | "dj_set";
  label: string;
  icon: typeof Headphones;
  desc: string;
}[] = [
  {
    id: "listening",
    spaceType: "listening",
    format: "release_party",
    label: "Release Party",
    icon: Headphones,
    desc: "Time-capped premiere with countdown and Q&A",
  },
  {
    id: "discussion",
    spaceType: "discussion",
    format: "discussion",
    label: "Discussion",
    icon: MessageCircle,
    desc: "Panels, AMAs, and open forums",
  },
  {
    id: "dj_set",
    spaceType: "dj_set",
    format: "dj_set",
    label: "DJ Set",
    icon: Radio,
    desc: "Continuous mix with track requests",
  },
];

export function RoomCreatePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, profileError } = useAuth();
  const canParticipate = useCanParticipate();
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  // Validate ?format= against this form's selectable formats so unknown or
  // dead values (including the removed Concert 'versus_battle', 20 Oct 2026)
  // always land on the honest Release Party default.
  const visibleTypes = spaceTypes;
  const requestedFormat = searchParams.get("format");
  const requestedType =
    visibleTypes.find((item) => item.format === requestedFormat)?.id ?? "listening";
  const [type, setType] = useState(requestedType);
  useEffect(() => {
    setType(requestedType);
  }, [requestedType]);
  // The room_format the picker is currently on, driving where "back" and a
  // scheduled create return to.
  const selectedFormat = spaceTypes.find((s) => s.id === type)?.format;

  const [scheduleFor, setScheduleFor] = useState<"now" | "later">("now");
  // Default schedule = 30 minutes from now, formatted for <input type=datetime-local>.
  const [scheduledAt, setScheduledAt] = useState(() => {
    const d = new Date(Date.now() + 30 * 60_000);
    // Convert to local-time YYYY-MM-DDTHH:mm.
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) {
      // If the profile fetch errored (rather than the member genuinely being
      // signed out), show the reason here instead of a mysterious bounce to
      // /social/auth.
      if (profileError) {
        setError("Couldn't load your profile. Please try again.");
        return;
      }
      router.push("/social/auth");
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

    // Server independently enforces sign-in on this endpoint (401 otherwise).
    const res = await authFetch("/api/social/spaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title,
        topic,
        // Post the constraint-safe `type`, not the UI id — see spaceTypes above.
        type: spaceTypes.find((s) => s.id === type)?.spaceType ?? "listening",
        room_format: spaceTypes.find((s) => s.id === type)?.format,
        scheduled_at,
      }),
    });

    if (res.ok) {
      const { space } = await res.json();
      router.push(
        // A scheduled room has nothing to enter yet, so land on the scheduled
        // tab rather than an empty room.
        scheduled_at
          ? roomScheduledHref(selectedFormat)
          : roomHref({ id: space.id, room_format: selectedFormat }),
      );
      return;
    }

    const data = await res.json().catch(() => ({}));
    setError(data?.error ?? "Could not create the space. Please try again.");
    setIsSubmitting(false);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 animate-fade-in">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <Link
            href={roomExitHref(selectedFormat)}
            className="p-2 hover:bg-melori-elevated rounded-lg transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <h2 className="text-2xl font-bold">
            Start a Space
          </h2>
        </div>

        {user && !canParticipate ? (
          <SignInPrompt action="start a Space" />
        ) : (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-sm text-melori-muted mb-2">
              Space Title
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Late Night Beat Breakdown"
              className="w-full bg-melori-elevated border border-melori-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition"
            />
          </div>

          <div>
            <label className="block text-sm text-melori-muted mb-2">
              Topic / Genre
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g., Trap Production, Neo-Soul"
              className="w-full bg-melori-elevated border border-melori-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition"
            />
          </div>

          <div>
            <label className="block text-sm text-melori-muted mb-3">
              When
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setScheduleFor("now")}
                className={`text-left p-4 rounded-xl border transition ${
                  scheduleFor === "now"
                    ? "border-melori-purple bg-melori-purple/10"
                    : "border-melori-border hover:border-melori-purple/30"
                }`}
              >
                <p className="font-medium text-sm">Go live now</p>
                <p className="text-xs text-melori-muted mt-1">
                  Open the room immediately
                </p>
              </button>
              <button
                type="button"
                onClick={() => setScheduleFor("later")}
                className={`text-left p-4 rounded-xl border transition ${
                  scheduleFor === "later"
                    ? "border-melori-purple bg-melori-purple/10"
                    : "border-melori-border hover:border-melori-purple/30"
                }`}
              >
                <p className="font-medium text-sm">Schedule for later</p>
                <p className="text-xs text-melori-muted mt-1">
                  Announce a start time
                </p>
              </button>
            </div>
            {scheduleFor === "later" && (
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                className="mt-3 w-full bg-melori-elevated border border-melori-border rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition"
              />
            )}
          </div>

            <div>
              <label className="block text-sm text-melori-muted mb-3">Room Format</label>
              <div className="grid grid-cols-2 gap-3">
                {visibleTypes.map((t) => {
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setType(t.id)}
                      className={`text-left p-4 rounded-xl border transition ${
                        type === t.id
                          ? "border-melori-purple bg-melori-purple/10"
                          : "border-melori-border hover:border-melori-purple/30"
                      }`}
                    >
                      <Icon
                        className={`w-5 h-5 mb-2 ${
                          type === t.id
                            ? "text-melori-purple"
                            : "text-melori-muted"
                        }`}
                      />
                      <p className="font-medium text-sm">{t.label}</p>
                      <p className="text-xs text-melori-muted mt-1">{t.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

          {error && (
            <p className="rounded-xl bg-red-500/10 p-3 text-sm text-red-400">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="btn-primary w-full py-3.5 rounded-xl font-semibold text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting
              ? scheduleFor === "later"
                ? "Scheduling..."
                : "Going Live..."
              : scheduleFor === "later"
                ? "Schedule Space"
                : "Go Live"}
          </button>
        </form>
        )}
      </div>
    </div>
  );
}

export default function CreateSpacePage() {
  return <RoomCreatePage />;
}
