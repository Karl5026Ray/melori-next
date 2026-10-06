"use client";

import { PLATFORM_MIN_AGE } from "@/lib/age";

// Required "I am 16 or older" checkbox for the email signup forms (/register
// and the /platform door). Melori's minimum age is 16.
//
// Signup is client-side Supabase auth (supabase.auth.signUp), so the
// attestation is recorded in the new user's metadata via ageAttestationMetadata()
// at signUp — there is no API route of ours in that path to stamp it.
export default function AgeAttestation({
  checked,
  onChange,
  termsHref = "/terms",
  privacyHref = "/privacy",
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  termsHref?: string;
  privacyHref?: string;
}) {
  return (
    <label className="flex items-start gap-3 text-left text-xs leading-relaxed text-[#aaa]">
      <input
        type="checkbox"
        required
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid="age-attestation"
        className="mt-0.5 h-4 w-4 shrink-0 accent-[#c9a96e]"
      />
      <span>
        I am {PLATFORM_MIN_AGE} or older, and I agree to the{" "}
        <a href={termsHref} target="_blank" rel="noreferrer" className="text-[#c9a96e] underline">
          Terms
        </a>{" "}
        and{" "}
        <a href={privacyHref} target="_blank" rel="noreferrer" className="text-[#c9a96e] underline">
          Privacy Policy
        </a>
        .
      </span>
    </label>
  );
}

export const AGE_ATTESTATION_REQUIRED = `Please confirm you are ${PLATFORM_MIN_AGE} or older.`;

/** user_metadata fields stamped on the account at signUp. */
export function ageAttestationMetadata(now: Date = new Date()) {
  return {
    age_attested_at: now.toISOString(),
    age_attested_min: PLATFORM_MIN_AGE,
  };
}
