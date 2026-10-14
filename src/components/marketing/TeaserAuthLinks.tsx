"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { safeNextPath } from "@/lib/mediaSetupMarker";

// The two buttons on a feature teaser, plus the way back in for a member who
// was only sent here because a cookie went missing.
//
// The proxy sends any request without a session cookie to the teaser with the
// page it wanted as ?next= (see gateRedirectTarget in src/proxy.ts). Safari
// deletes script-written cookies after 7 days while the session survives in
// the localStorage mirror, so "no cookie" often means "signed in, cookie
// evicted". getSession() reads the mirror, and the storage adapter rewrites the
// cookie as it does, so forwarding to `next` passes the wall this time.
//
// Only forwards when there is a `next`: a signed-in member who opens /cinema on
// purpose is reading the page and stays on it.
export default function TeaserAuthLinks() {
  const router = useRouter();
  const params = useSearchParams();
  const rawNext = params.get("next");
  // null when absent or unsafe; never an off-site URL.
  const next = rawNext ? safeNextPath(rawNext, "") || null : null;

  useEffect(() => {
    if (!next) return;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (active && data.session) router.replace(next);
    });
    return () => {
      active = false;
    };
  }, [next, router]);

  const carry = next ? `?next=${encodeURIComponent(next)}` : "";

  return (
    <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-center">
      <Link
        href={`/register${carry}`}
        className="rounded-full bg-brand-primary px-7 py-3 text-center text-sm font-semibold text-white transition-colors hover:bg-brand-primary-dark"
      >
        Create your free account
      </Link>
      <Link
        href={`/social/auth${carry}`}
        className="rounded-full border border-brand-border px-7 py-3 text-center text-sm font-semibold text-text-primary transition-colors hover:border-brand-primary hover:text-brand-primary"
      >
        Already a member? Sign in
      </Link>
    </div>
  );
}
