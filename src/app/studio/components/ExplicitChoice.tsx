"use client";

// Required Explicit yes/no for a track upload. Deliberately has no default:
// the artist must answer, so an unlabeled explicit track is the artist's
// choice, not a form default. `value === null` means "not answered yet".
//
// Shared by the Studio uploader and the quick /upload page so both ask the
// same question with the same warning.
export default function ExplicitChoice({
  value,
  onChange,
  disabled = false,
  tone = "studio",
}: {
  value: boolean | null;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  tone?: "studio" | "site";
}) {
  const muted = tone === "studio" ? "text-[#888]" : "text-text-secondary";
  const option = (selected: boolean) =>
    `flex-1 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors ${
      selected
        ? tone === "studio"
          ? "border-[#c9a96e] bg-[#c9a96e]/15 text-white"
          : "border-brand-primary bg-brand-primary/15 text-text-primary"
        : "border-white/10 bg-white/5 text-[#bbb] hover:border-white/25"
    }`;

  return (
    <fieldset disabled={disabled}>
      <legend className={`mb-1 block text-sm ${muted}`}>
        Explicit content? <span className="text-red-400">*</span>
      </legend>
      <div role="radiogroup" className="flex gap-2">
        <button
          type="button"
          role="radio"
          aria-checked={value === true}
          onClick={() => onChange(true)}
          className={option(value === true)}
        >
          Yes, explicit
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={value === false}
          onClick={() => onChange(false)}
          className={option(value === false)}
        >
          No, clean
        </button>
      </div>
      <p className={`mt-1.5 text-xs ${muted}`}>
        Strong language, sexual content or violence counts as explicit. Explicit
        tracks get an E badge and stay off the homepage radio. Songs with
        explicit content that aren&apos;t marked explicit may be removed.
      </p>
    </fieldset>
  );
}
