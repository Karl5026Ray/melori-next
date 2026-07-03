"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { isSuperfanOrBetter } from "@/lib/membership";

// Client-side hook: is the signed-in social user allowed to PARTICIPATE
// (post/create, comment/reply, join voice)? Free + logged-out users may only
// view and listen. Server routes enforce the same rule independently.
export function useCanParticipate(): boolean {
  const { user } = useAuth();
  return isSuperfanOrBetter(user);
}

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
        <Sparkles className="h-6 w-6 text-melori-purple" />
      </div>
      <h3 className="text-lg font-bold">Become a Superfan to {action}</h3>
      <p className="mx-auto mt-1 mb-4 max-w-sm text-sm text-melori-muted">
        Free members can view and listen. Posting, replying, and joining voice
        conversations are Superfan features — just $2.99/mo.
      </p>
      <Link
        href="/membership"
        className="btn-primary inline-flex items-center gap-2 rounded-full px-6 py-3 text-sm font-semibold"
      >
        <Sparkles className="h-4 w-4" />
        Upgrade to Superfan
      </Link>
    </div>
  );
}
