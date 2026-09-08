"use client";

import Link from "next/link";
import { LogIn } from "lucide-react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { isSuperfanOrBetter } from "@/lib/membership";
import { canRaiseHand } from "@/lib/spacesStage";

// Client-side hook: is the caller allowed to PARTICIPATE (post/create,
// comment/reply, join voice)? Paid tiers were removed from Melori, so this is
// now purely "are you signed in" — every signed-in account participates.
// Logged-out visitors may still view and listen. Server routes enforce the
// same rule independently (requireAuth → 401).
export function useCanParticipate(): boolean {
  const { user } = useAuth();
  return isSuperfanOrBetter(user);
}

// Spaces-voice carve-out (Clubhouse parity): any SIGNED-IN user may raise a
// hand to request the stage. It says nothing about whether they may currently
// SPEAK — that still requires the host to have promoted them to
// 'speaker'/'host' (see canSpeak in spacesStage.ts, checked against the
// participant's role at the call site).
export function useCanRequestStage(): boolean {
  const { user } = useAuth();
  return canRaiseHand({ signedIn: !!user });
}

// Shown when a signed-out visitor reaches something that needs an account.
// This used to be a paid-tier upsell ("Become a Superfan to …"). There are no
// tiers and nothing to buy on Melori, so the only thing standing between a
// visitor and this action is a free account — say exactly that.
export function UpgradePrompt({
  action = "participate",
  className = "",
}: {
  action?: string;
  className?: string;
}) {
  return (
    <div
      className={`rounded-2xl border border-melori-purple/30 bg-melori-purple/10 p-5 text-center ${className}`}
    >
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-melori-purple/20">
        <LogIn className="h-6 w-6 text-melori-purple" />
      </div>
      <h3 className="text-lg font-bold">Sign in to {action}</h3>
      <p className="mx-auto mt-1 mb-4 max-w-sm text-sm text-melori-muted">
        Anyone can view and listen. Creating a free account lets you post,
        reply, and join the conversation.
      </p>
      <Link
        href="/social/auth"
        className="inline-block rounded-full bg-melori-purple px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-melori-purple/80"
      >
        Sign in or create an account
      </Link>
    </div>
  );
}
