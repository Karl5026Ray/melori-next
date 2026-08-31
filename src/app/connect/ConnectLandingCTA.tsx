"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Heart, Loader2 } from "lucide-react";

// Auth-aware primary CTA for the Connect landing page. Logged-out visitors go
// to sign-in; signed-in members jump straight into the swipe stack. Keeps the
// landing page itself a static server component — only this island is client.
export default function ConnectLandingCTA() {
  const [state, setState] = useState<"loading" | "guest" | "member">("loading");

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setState(data.session ? "member" : "guest");
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      if (!active) return;
      setState(session ? "member" : "guest");
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (state === "loading") {
    return (
      <span className="inline-flex items-center gap-2 rounded-full bg-brand-primary px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-primary/30">
        <Loader2 className="h-5 w-5 animate-spin" />
      </span>
    );
  }

  return (
    <Link
      href="/social/connect"
      className="inline-flex items-center gap-2 rounded-full bg-brand-primary px-8 py-3.5 text-base font-semibold text-white shadow-lg shadow-brand-primary/30 transition-transform hover:scale-[1.03] active:scale-95"
    >
      <Heart className="h-5 w-5" />
      {state === "member" ? "Open Connect" : "Start matching — it's free to look"}
    </Link>
  );
}
