"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Heart, ArrowLeft } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/components/social/providers/AuthProvider";
import type { PromptOption } from "@/components/social/connect/types";

// Dating opt-in flow. One explicit, revocable enrollment: 18+ attestation (dob),
// a SEPARATE sensitive-data consent, intent, photo selection (reused from the
// existing profile gallery — no re-upload), 3 music prompts, and preferences.
const GENDERS = ["woman", "man", "nonbinary", "other"];
const INTENTS = [
  { value: "dating", label: "Dating" },
  { value: "friends", label: "Friends" },
  { value: "either", label: "Either" },
];

export default function OnboardingPage() {
  const router = useRouter();
  const { user, isLoading } = useAuth();

  const [dob, setDob] = useState("");
  const [consent, setConsent] = useState(false);
  const [intent, setIntent] = useState("either");
  const [shownGender, setShownGender] = useState("");
  const [seeking, setSeeking] = useState<string[]>([]);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(45);
  const [maxDistance, setMaxDistance] = useState(160);
  const [bio, setBio] = useState("");

  const [gallery, setGallery] = useState<{ image_url: string }[]>([]);
  const [selectedPhotos, setSelectedPhotos] = useState<string[]>([]);

  const [prompts, setPrompts] = useState<PromptOption[]>([]);
  const [answers, setAnswers] = useState<Record<number, string>>({});

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing dating profile (to prefill), the prompt library, and the
  // member's existing photo gallery (public-read).
  useEffect(() => {
    if (isLoading || !user?.id) return;
    (async () => {
      try {
        const [profileRes, promptsRes] = await Promise.all([
          authFetch("/api/social/connect/profile"),
          authFetch("/api/social/connect/prompts"),
        ]);
        if (profileRes.ok) {
          const j = await profileRes.json();
          const p = j.profile;
          if (p) {
            setDob(p.dob ?? "");
            setConsent(!!p.consent_sensitive);
            setIntent(p.intent ?? "either");
            setShownGender(p.shown_gender ?? "");
            setSeeking(p.seeking_gender ?? []);
            setAgeMin(p.age_min ?? 18);
            setAgeMax(p.age_max ?? 45);
            setMaxDistance(p.max_distance_km ?? 160);
            setBio(p.bio_override ?? "");
          }
          if (Array.isArray(j.photos)) {
            setSelectedPhotos(j.photos.map((ph: { image_url: string }) => ph.image_url));
          }
          if (Array.isArray(j.prompts)) {
            const map: Record<number, string> = {};
            for (const a of j.prompts) map[a.prompt_id] = a.answer;
            setAnswers(map);
          }
        }
        if (promptsRes.ok) {
          const j = await promptsRes.json();
          setPrompts(j.prompts ?? []);
        }
        const { data: g } = await supabase
          .from("profile_gallery")
          .select("image_url, sort_order")
          .eq("profile_id", user.id)
          .order("sort_order", { ascending: true });
        setGallery((g as { image_url: string }[]) ?? []);
      } catch {
        /* defensive — the form still works empty */
      }
    })();
  }, [isLoading, user]);

  function toggle<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function selectedAnswers() {
    return Object.entries(answers)
      .filter(([, v]) => v && v.trim())
      .slice(0, 3)
      .map(([prompt_id, answer]) => ({ prompt_id: Number(prompt_id), answer }));
  }

  async function save(activate: boolean) {
    setError(null);
    if (!dob) {
      setError("Please enter your date of birth.");
      return;
    }
    if (activate && !consent) {
      setError("Please consent to dating data processing to activate your profile.");
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/social/connect/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dob,
          consent_sensitive: consent,
          is_active: activate,
          intent,
          shown_gender: shownGender || null,
          seeking_gender: seeking,
          age_min: ageMin,
          age_max: ageMax,
          max_distance_km: maxDistance,
          bio_override: bio || null,
          photos: selectedPhotos,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(j.error ?? "Could not save your profile.");
        return;
      }
      // Save prompt answers separately.
      await authFetch("/api/social/connect/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: selectedAnswers() }),
      });
      router.push("/social/connect");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) return <div className="p-8 text-melori-muted">Loading…</div>;
  if (!user) {
    return (
      <div className="p-8 text-center text-melori-muted">
        Please <Link href="/social/auth" className="text-brand-primary">sign in</Link> to continue.
      </div>
    );
  }

  const chosenPromptCount = selectedAnswers().length;

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6 pb-28">
      <div className="mb-6 flex items-center gap-3">
        <Link href="/social/connect" className="text-melori-muted hover:text-melori-text">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Heart className="h-6 w-6 text-melori-pink" fill="currentColor" /> Set up Connect
        </h1>
      </div>

      {/* Age gate */}
      <Section title="Your age" subtitle="Melori Connect is strictly 18+.">
        <input
          type="date"
          value={dob}
          onChange={(e) => setDob(e.target.value)}
          className="w-full rounded-xl border border-melori-border bg-melori-elevated px-4 py-2.5 text-sm focus:border-brand-primary focus:outline-none"
        />
      </Section>

      {/* Consent */}
      <Section title="Consent" subtitle="Separate from Melori's general terms.">
        <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-melori-border bg-melori-elevated p-3">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 accent-melori-purple"
          />
          <span className="text-sm text-melori-muted">
            I consent to Melori processing my dating-specific and sensitive data
            (orientation, dating intent) to provide Melori Connect. I can revoke this
            anytime by deactivating my dating profile.
          </span>
        </label>
      </Section>

      {/* Intent */}
      <Section title="I'm here for">
        <div className="flex gap-2">
          {INTENTS.map((i) => (
            <Pill key={i.value} active={intent === i.value} onClick={() => setIntent(i.value)}>
              {i.label}
            </Pill>
          ))}
        </div>
      </Section>

      {/* Gender / seeking */}
      <Section title="I identify as">
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <Pill key={g} active={shownGender === g} onClick={() => setShownGender(g)}>
              {g}
            </Pill>
          ))}
        </div>
      </Section>
      <Section title="I'm interested in" subtitle="Leave empty to be open to everyone.">
        <div className="flex flex-wrap gap-2">
          {GENDERS.map((g) => (
            <Pill key={g} active={seeking.includes(g)} onClick={() => setSeeking(toggle(seeking, g))}>
              {g}
            </Pill>
          ))}
        </div>
      </Section>

      {/* Photos */}
      <Section
        title="Photos"
        subtitle={
          gallery.length > 0
            ? "Pick from your existing profile photos."
            : "Add photos to your profile gallery first, then pick them here."
        }
      >
        {gallery.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {gallery.map((g) => {
              const selected = selectedPhotos.includes(g.image_url);
              return (
                <button
                  key={g.image_url}
                  type="button"
                  onClick={() => setSelectedPhotos(toggle(selectedPhotos, g.image_url))}
                  className={`relative aspect-square overflow-hidden rounded-xl border-2 ${
                    selected ? "border-melori-purple" : "border-transparent"
                  }`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={g.image_url} alt="" className="h-full w-full object-cover" />
                  {selected && (
                    <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-melori-purple text-white">
                      <Check className="h-3 w-3" />
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ) : (
          <Link href="/social/profile" className="text-sm text-brand-primary">
            Manage profile photos →
          </Link>
        )}
      </Section>

      {/* Prompts */}
      <Section title="Music prompts" subtitle={`Answer up to 3 (${chosenPromptCount}/3).`}>
        <div className="space-y-3">
          {prompts.map((p) => (
            <div key={p.id} className="rounded-xl border border-melori-border bg-melori-elevated p-3">
              <label className="text-xs font-medium uppercase tracking-wide text-melori-muted">
                {p.text}
              </label>
              <input
                type="text"
                value={answers[p.id] ?? ""}
                onChange={(e) => setAnswers((a) => ({ ...a, [p.id]: e.target.value }))}
                placeholder="Your answer…"
                maxLength={500}
                className="mt-1.5 w-full rounded-lg border border-melori-border bg-melori-surface px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
              />
            </div>
          ))}
        </div>
      </Section>

      {/* Preferences */}
      <Section title="Preferences">
        <div className="space-y-4">
          <div>
            <div className="mb-1 flex justify-between text-sm text-melori-muted">
              <span>Age range</span>
              <span>{ageMin}–{ageMax}</span>
            </div>
            <div className="flex items-center gap-3">
              <input
                type="number"
                min={18}
                max={120}
                value={ageMin}
                onChange={(e) => setAgeMin(Number(e.target.value))}
                className="w-20 rounded-lg border border-melori-border bg-melori-elevated px-2 py-1.5 text-sm"
              />
              <span className="text-melori-muted">to</span>
              <input
                type="number"
                min={18}
                max={120}
                value={ageMax}
                onChange={(e) => setAgeMax(Number(e.target.value))}
                className="w-20 rounded-lg border border-melori-border bg-melori-elevated px-2 py-1.5 text-sm"
              />
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-sm text-melori-muted">
              <span>Max distance</span>
              <span>{maxDistance} km</span>
            </div>
            <input
              type="range"
              min={5}
              max={500}
              step={5}
              value={maxDistance}
              onChange={(e) => setMaxDistance(Number(e.target.value))}
              className="w-full accent-melori-purple"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm text-melori-muted">Dating bio (optional)</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              rows={3}
              maxLength={1000}
              placeholder="A little about what you're looking for…"
              className="w-full rounded-xl border border-melori-border bg-melori-elevated px-3 py-2 text-sm focus:border-brand-primary focus:outline-none"
            />
          </div>
        </div>
      </Section>

      {error && <p className="mb-3 text-sm text-melori-danger">{error}</p>}

      <div className="flex flex-col gap-2">
        <button
          onClick={() => void save(true)}
          disabled={saving}
          className="rounded-full bg-gradient-to-r from-melori-purple to-melori-pink px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Activate my dating profile"}
        </button>
        <button
          onClick={() => void save(false)}
          disabled={saving}
          className="rounded-full border border-melori-border px-6 py-3 text-sm font-medium text-melori-muted transition hover:text-melori-text disabled:opacity-50"
        >
          Save as draft (stay hidden)
        </button>
      </div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-6">
      <h2 className="text-sm font-bold">{title}</h2>
      {subtitle && <p className="mb-2 text-xs text-melori-muted">{subtitle}</p>}
      {!subtitle && <div className="mb-2" />}
      {children}
    </section>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-1.5 text-sm capitalize transition ${
        active
          ? "border-melori-purple bg-melori-purple/20 text-melori-text"
          : "border-melori-border bg-melori-elevated text-melori-muted hover:text-melori-text"
      }`}
    >
      {children}
    </button>
  );
}
