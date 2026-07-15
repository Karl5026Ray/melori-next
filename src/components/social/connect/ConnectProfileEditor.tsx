"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/authClient";

const GENDERS = [
  { v: "woman", l: "Woman" },
  { v: "man", l: "Man" },
  { v: "nonbinary", l: "Nonbinary" },
  { v: "other", l: "Other" },
];

interface DatingProfile {
  is_active?: boolean;
  birthdate?: string | null;
  gender?: string | null;
  interested_in?: string[];
  age_min?: number;
  age_max?: number;
  city?: string | null;
  headline?: string | null;
  photos?: string[];
}

// Slide-over editor for the caller's Connect profile + match preferences.
// Photos are uploaded to Supabase Storage via the existing upload endpoint
// pattern; here we accept URLs already produced by that flow to keep v1 lean.
export default function ConnectProfileEditor({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [isActive, setIsActive] = useState(true);
  const [birthdate, setBirthdate] = useState("");
  const [gender, setGender] = useState<string>("");
  const [interestedIn, setInterestedIn] = useState<string[]>([
    "woman",
    "man",
    "nonbinary",
  ]);
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(99);
  const [city, setCity] = useState("");
  const [headline, setHeadline] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [photoInput, setPhotoInput] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const res = await authFetch("/api/social/connect/profile");
        if (res.ok) {
          const { profile } = (await res.json()) as {
            profile: DatingProfile | null;
          };
          if (profile) {
            setIsActive(profile.is_active ?? true);
            setBirthdate(profile.birthdate ?? "");
            setGender(profile.gender ?? "");
            setInterestedIn(
              profile.interested_in ?? ["woman", "man", "nonbinary"],
            );
            setAgeMin(profile.age_min ?? 18);
            setAgeMax(profile.age_max ?? 99);
            setCity(profile.city ?? "");
            setHeadline(profile.headline ?? "");
            setPhotos(profile.photos ?? []);
          }
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const toggleInterest = (v: string) =>
    setInterestedIn((prev) =>
      prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v],
    );

  const addPhoto = () => {
    const url = photoInput.trim();
    if (url && photos.length < 9) {
      setPhotos((p) => [...p, url]);
      setPhotoInput("");
    }
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch("/api/social/connect/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          is_active: isActive,
          birthdate: birthdate || null,
          gender: gender || null,
          interested_in: interestedIn,
          age_min: ageMin,
          age_max: ageMax,
          city,
          headline,
          photos,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setError(d.error || "Could not save. Try again.");
        return;
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/60">
      <div className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-melori-void p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Connect profile</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-full p-2 hover:bg-white/5"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-melori-pink" />
          </div>
        ) : (
          <div className="space-y-5">
            {/* Active toggle */}
            <label className="flex items-center justify-between rounded-xl bg-melori-elevated p-3">
              <span className="text-sm font-medium">
                Show me on Connect
              </span>
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                className="h-5 w-5 accent-[color:var(--brand-primary)]"
              />
            </label>

            <Field label="Headline">
              <input
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                maxLength={160}
                placeholder="Vinyl collector. Always chasing the next great record."
                className="input"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Birthdate">
                <input
                  type="date"
                  value={birthdate}
                  onChange={(e) => setBirthdate(e.target.value)}
                  className="input"
                />
              </Field>
              <Field label="City">
                <input
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="Chicago"
                  className="input"
                />
              </Field>
            </div>

            <Field label="I am">
              <div className="flex flex-wrap gap-2">
                {GENDERS.map((g) => (
                  <Chip
                    key={g.v}
                    active={gender === g.v}
                    onClick={() => setGender(g.v)}
                  >
                    {g.l}
                  </Chip>
                ))}
              </div>
            </Field>

            <Field label="Interested in">
              <div className="flex flex-wrap gap-2">
                {GENDERS.filter((g) => g.v !== "other").map((g) => (
                  <Chip
                    key={g.v}
                    active={interestedIn.includes(g.v)}
                    onClick={() => toggleInterest(g.v)}
                  >
                    {g.l}
                  </Chip>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={`Min age: ${ageMin}`}>
                <input
                  type="range"
                  min={18}
                  max={99}
                  value={ageMin}
                  onChange={(e) => setAgeMin(Number(e.target.value))}
                  className="w-full accent-[color:var(--brand-primary)]"
                />
              </Field>
              <Field label={`Max age: ${ageMax}`}>
                <input
                  type="range"
                  min={18}
                  max={99}
                  value={ageMax}
                  onChange={(e) => setAgeMax(Number(e.target.value))}
                  className="w-full accent-[color:var(--brand-primary)]"
                />
              </Field>
            </div>

            <Field label="Photos">
              {photos.length > 0 && (
                <div className="mb-2 grid grid-cols-3 gap-2">
                  {photos.map((p, i) => (
                    <div key={i} className="relative">
                      <img
                        src={p}
                        alt=""
                        className="h-24 w-full rounded-lg object-cover"
                      />
                      <button
                        onClick={() =>
                          setPhotos((prev) => prev.filter((_, x) => x !== i))
                        }
                        className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5"
                        aria-label="Remove photo"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <input
                  value={photoInput}
                  onChange={(e) => setPhotoInput(e.target.value)}
                  placeholder="Paste a photo URL"
                  className="input flex-1"
                />
                <button
                  onClick={addPhoto}
                  className="rounded-lg bg-white/10 px-3 text-sm"
                >
                  Add
                </button>
              </div>
            </Field>

            {error && <p className="text-sm text-red-400">{error}</p>}

            <button
              onClick={save}
              disabled={saving}
              className="w-full rounded-full bg-brand-primary py-3 font-semibold text-white disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        )}
      </div>

      <style jsx>{`
        :global(.input) {
          width: 100%;
          border-radius: 0.5rem;
          background: var(--melori-elevated, #1a1a1a);
          border: 1px solid rgba(255, 255, 255, 0.1);
          padding: 0.6rem 0.75rem;
          font-size: 0.9rem;
          color: white;
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-melori-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function Chip({
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
      onClick={onClick}
      className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
        active
          ? "bg-brand-primary text-white"
          : "bg-melori-elevated text-melori-muted hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
