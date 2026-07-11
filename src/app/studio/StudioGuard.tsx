"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { isArtistSubscriber } from "@/lib/membership";
import { authFetch } from "@/lib/authClient";

// Client-side gate for the Artist Studio. Supabase auth here is localStorage-based
// (no cookies), so a true server redirect can't see the session — instead we block
// rendering until we've confirmed the caller is an active artist-tier subscriber,
// and redirect everyone else to /membership. The studio's own API routes are
// independently protected server-side (requireArtist → 401/403).
export default function StudioGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [status, setStatus] = useState<"checking" | "allowed">("checking");

  useEffect(() => {
    let active = true;

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.replace("/membership");
        return;
      }

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, membership_status")
        .eq("id", session.user.id)
        .maybeSingle();

      if (!active) return;

      if (isArtistSubscriber(profile)) {
        setStatus("allowed");
        // Self-heal: ensure this artist has a linked `artists` row so the
        // dashboard/studio stats populate. Idempotent + fire-and-forget.
        void authFetch("/api/artist/ensure-row", { method: "POST" }).catch(
          () => {},
        );
      } else {
        router.replace("/membership");
      }
    })();

    return () => {
      active = false;
    };
  }, [router]);

  if (status !== "allowed") {
    return (
      <div className="flex min-h-[60vh] w-full items-center justify-center bg-gradient-to-br from-[#0a0a0a] via-[#1a1a2e] to-[#0a0a0a] text-white">
        <div className="flex flex-col items-center gap-3">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-[#c9a96e]/40 border-t-[#c9a96e]" />
          <p className="text-sm text-[#888]">Checking studio access…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
