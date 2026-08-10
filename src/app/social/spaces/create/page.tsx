"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/social/providers/AuthProvider";
import {
  useCanParticipate,
  UpgradePrompt,
} from "@/components/social/UpgradePrompt";
import { authFetch } from "@/lib/authClient";
import {
  ArrowLeft,
  Headphones,
  MessageCircle,
  Mic,
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
  spaceType: "listening" | "discussion" | "creation" | "dj_set";
  format: "release_party" | "discussion" | "versus_battle" | "dj_set";
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
    id: "creation",
    spaceType: "creation",
    format: "versus_battle",
    label: "Versus Battle",
    icon: Mic,
    desc: "Head-to-head showdown with live voting",
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

export default function CreateSpacePage() {
  const router = useRouter();
  const { user, profileError } = useAuth();
  const canParticipate = useCanParticipate();
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  // No ?format= handling any more. This form used to read ?format=cinema and
  // preselect the Cinema tile for hosts arriving from the Cinema discover
  // screen; Cinema now has its own route, so every format this page can create
  // is an audio Space and Release Party is the honest default.
  const [type, setType] = useState("listening");
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

    // Server independently enforces Superfan+ on this endpoint (403 otherwise).
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

    if (res.status === 403) {
      router.push("/membership");
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
          <h2 className="text-2xl font-bold">Start a Space</h2>
        </div>

        {user && !canParticipate ? (
          <UpgradePrompt action="start a Space" />
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
              {spaceTypes.map((t) => {
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
