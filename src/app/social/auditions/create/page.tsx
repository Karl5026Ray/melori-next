"use client";

// Open an MM Auditions room. The director picks the type and whether it's
// OPEN (listed under Auditions, anyone signed in can enter the lobby) or
// PRIVATE (invite code / named invites only). Callbacks are always private.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowLeft, Drama, Lock, Globe } from "lucide-react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";
import {
  AUDITION_FORMAT_CONFIG,
  AUDITION_ROOM_FORMATS,
  AUDITIONS_HOME,
  auditionRoomHref,
  type AuditionRoomFormat,
} from "@/lib/auditions";

export default function CreateAuditionPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [format, setFormat] = useState<AuditionRoomFormat>("audition");
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [isPrivate, setIsPrivate] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const forcedPrivate = format === "callback";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) {
      router.push(`/social/auth?next=${encodeURIComponent(`${AUDITIONS_HOME}/create`)}`);
      return;
    }
    setBusy(true);
    setError("");
    const res = await authFetch("/api/auditions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, topic, room_format: format, is_private: forcedPrivate || isPrivate }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      router.push(auditionRoomHref(data.room.id));
      return;
    }
    setError(data?.error ?? "Could not open the room. Please try again.");
    setBusy(false);
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 pb-28 md:p-8 md:pb-8 animate-fade-in">
      <div className="mx-auto max-w-lg">
        <div className="mb-6 flex items-center gap-3">
          <Link href={AUDITIONS_HOME} aria-label="Back to Auditions" className="rounded-lg p-2 hover:bg-melori-surface">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <Drama className="h-6 w-6 text-melori-teal" />
          <h1 className="text-2xl font-bold">Open a room</h1>
        </div>

        <form onSubmit={submit} className="space-y-6">
          <fieldset>
            <legend className="mb-3 block text-sm text-melori-muted">Type</legend>
            <div className="grid gap-2">
              {AUDITION_ROOM_FORMATS.map((f) => (
                <label
                  key={f}
                  className={`flex cursor-pointer gap-3 rounded-xl border p-4 transition ${
                    format === f ? "border-melori-purple bg-melori-purple/10" : "border-melori-border bg-melori-surface"
                  }`}
                >
                  <input
                    type="radio"
                    name="format"
                    value={f}
                    checked={format === f}
                    onChange={() => setFormat(f)}
                    className="mt-1 accent-[#8b5cf6]"
                  />
                  <span>
                    <span className="block text-sm font-semibold">{AUDITION_FORMAT_CONFIG[f].label}</span>
                    <span className="block text-xs text-melori-muted">{AUDITION_FORMAT_CONFIG[f].blurb}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          <div>
            <label htmlFor="aud-title" className="mb-2 block text-sm text-melori-muted">
              Title
            </label>
            <input
              id="aud-title"
              required
              maxLength={200}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., WOE Episode 1 — table read"
              className="w-full rounded-xl border border-melori-border bg-melori-surface px-4 py-3 text-sm focus:border-melori-purple focus:outline-none"
            />
          </div>

          <div>
            <label htmlFor="aud-topic" className="mb-2 block text-sm text-melori-muted">
              Notes for actors (optional)
            </label>
            <textarea
              id="aud-topic"
              maxLength={500}
              rows={3}
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Roles, what to prepare, how long each read runs…"
              className="w-full rounded-xl border border-melori-border bg-melori-surface px-4 py-3 text-sm focus:border-melori-purple focus:outline-none"
            />
          </div>

          <fieldset>
            <legend className="mb-3 block text-sm text-melori-muted">Who can find it</legend>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: true, label: "Private", sub: "Invite code only", Icon: Lock },
                { value: false, label: "Open", sub: "Listed under Auditions", Icon: Globe },
              ].map(({ value, label, sub, Icon }) => {
                const selected = (forcedPrivate || isPrivate) === value;
                const disabled = forcedPrivate && !value;
                return (
                  <button
                    key={label}
                    type="button"
                    disabled={disabled}
                    onClick={() => setIsPrivate(value)}
                    className={`rounded-xl border p-3 text-left transition disabled:opacity-40 ${
                      selected ? "border-melori-purple bg-melori-purple/10" : "border-melori-border bg-melori-surface"
                    }`}
                  >
                    <Icon className="h-4 w-4 text-melori-teal" />
                    <span className="mt-1 block text-sm font-semibold">{label}</span>
                    <span className="block text-xs text-melori-muted">{sub}</span>
                  </button>
                );
              })}
            </div>
            {forcedPrivate && <p className="mt-2 text-xs text-melori-muted">Callbacks are always private.</p>}
          </fieldset>

          <p className="rounded-xl bg-melori-surface p-3 text-xs text-melori-muted">
            You can record up to 3 takes. Recordings and uploaded files are deleted when the session
            ends, so download what you want to keep before you end it.
          </p>

          {error && <p className="text-sm text-melori-danger">{error}</p>}

          <button
            type="submit"
            disabled={busy || !title.trim()}
            className="min-h-12 w-full rounded-xl bg-melori-purple text-sm font-semibold disabled:opacity-50"
          >
            {busy ? "Opening…" : "Open the room"}
          </button>
        </form>
      </div>
    </div>
  );
}
