"use client";

import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MediaSetupCard } from "@/components/onboarding/MediaSetupCard";
import { safeNextPath } from "@/lib/mediaSetupMarker";

// One-time post-signup camera/microphone step.
//
// Reached only from the signup paths (free signup on /register, paid welcome on
// /welcome), always with ?next=<where the user was going>. It is deliberately
// NOT wired into /auth/callback: OAuth and email-confirmation links come back
// through there for returning sign-ins too, and inserting a permission gate
// there would trap people who are simply logging in.
//
// No permission is requested on load — see MediaSetupCard.
function MediaSetupInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));

  return (
    <main
      data-testid="media-setup-page"
      className="flex min-h-screen items-center justify-center bg-[#0a0a0a] px-4 py-12 text-white"
    >
      <div className="w-full max-w-md">
        <p className="mb-4 text-center text-xs uppercase tracking-widest text-[#c9a96e]">
          One last thing
        </p>
        <MediaSetupCard onDone={() => router.replace(next)} />
      </div>
    </main>
  );
}

export default function MediaSetupPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#0a0a0a]" />}>
      <MediaSetupInner />
    </Suspense>
  );
}
