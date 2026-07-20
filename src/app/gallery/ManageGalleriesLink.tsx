"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Settings } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { isArtistSubscriber, isAdmin } from "@/lib/membership";

// Client-side entry point shown only to artist/admin on the public /gallery
// index. Supabase auth here is localStorage/cookie-based (no server cookies
// to read on the RSC), so this checks the session client-side, mirroring
// StudioGuard's own tier check.
export default function ManageGalleriesLink() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, membership_status")
        .eq("id", session.user.id)
        .maybeSingle();
      if (cancelled) return;

      if (isArtistSubscriber(profile) || isAdmin(profile)) {
        setVisible(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!visible) return null;

  return (
    <Link
      href="/studio/galleries"
      className="inline-flex items-center gap-1.5 rounded-full border border-brand-border bg-brand-surface px-3 py-1.5 text-xs font-semibold text-text-primary hover:border-brand-primary transition-colors"
    >
      <Settings className="h-3.5 w-3.5" />
      Manage galleries
    </Link>
  );
}
