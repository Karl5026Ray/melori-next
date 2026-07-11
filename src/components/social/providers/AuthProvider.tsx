"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { Profile } from "@/types/social";

interface AuthContextType {
  user: Profile | null;
  isLoading: boolean;
  signOut: () => Promise<void>;
  // Re-reads the signed-in user's `profiles` row and updates context.
  // Call after any mutation that changes the current user's profile so the
  // Header, sidebars, and other consumers pick up the new values without
  // requiring a full page reload.
  refreshUser: () => Promise<void>;
  // Optimistic local update — used right after the Edit Profile modal saves
  // so the UI reflects new fields immediately, before the network refresh.
  applyUser: (next: Profile) => void;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  isLoading: true,
  signOut: async () => {},
  refreshUser: async () => {},
  applyUser: () => {},
});

export function SocialAuthProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, setUser] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Track the current user id in a ref so callbacks stay stable while still
  // seeing the latest value.
  const userIdRef = useRef<string | null>(null);

  const loadProfile = useCallback(async (id: string) => {
    // Select explicit columns rather than "*". PostgREST fails the ENTIRE query
    // if any column is unknown (or lacks a SELECT grant for the authenticated
    // role), which would leave `user` null — and a null user makes the shared
    // gate (isSuperfanOrBetter) treat an Artist as free (the "Become a Superfan"
    // wall on /social/community) AND bounces genuinely-logged-in members to
    // /social/auth from the create-space submit (`if (!user)`).
    //
    // `role` is the SOURCE OF TRUTH for the participation gate (see membership.ts
    // effectiveTierString), so we select it here. We do NOT select
    // `membership_tier` / `membership_expires_at`: those are optional derived
    // Stripe fields that are ABSENT on this `profiles` table (see the notes in
    // membership-server.ts and /api/user/me, which reads them defensively). Naming
    // them in an explicit select made every profile fetch error out — the exact
    // failure this comment warns about.
    const { data } = await supabase
      .from("profiles")
      .select(
        "id, username, display_name, full_name, avatar_url, role, bio, verified, followers_count, following_count, created_at, membership_status",
      )
      .eq("id", id)
      .maybeSingle();
    if (data) {
      setUser({
        ...data,
        display_name: data.display_name || data.full_name || data.username,
      } as Profile);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    // Resolve a session into a loaded profile. Profile loading is deferred out
    // of the auth callback with setTimeout(0): @supabase/supabase-js runs the
    // onAuthStateChange callback while holding its internal auth lock, and any
    // PostgREST query (loadProfile -> supabase.from) attaches the bearer token
    // by re-acquiring that same lock. Awaiting the query INSIDE the callback
    // therefore deadlocks — getSession() and the profiles fetch both hang, so
    // on a hard load of /social/* with a token in localStorage NO profiles
    // request is ever made, `user` stays null, and an Artist is walled behind
    // "Become a Superfan to comment". Deferring lets the callback return and
    // release the lock before the query runs.
    const applySession = (session: { user?: { id: string } } | null) => {
      const id = session?.user?.id ?? null;
      if (!id) {
        userIdRef.current = null;
        setUser(null);
        setIsLoading(false);
        return;
      }
      // Guard duplicate loads: repeated TOKEN_REFRESHED/INITIAL_SESSION events
      // for the same user shouldn't refetch. A different id always reloads.
      const alreadyLoaded = userIdRef.current === id;
      userIdRef.current = id;
      if (alreadyLoaded) {
        setIsLoading(false);
        return;
      }
      setTimeout(() => {
        if (cancelled) return;
        loadProfile(id).finally(() => {
          if (!cancelled) setIsLoading(false);
        });
      }, 0);
    };

    // INITIAL_SESSION (fired on mount for the persisted session), SIGNED_IN and
    // TOKEN_REFRESHED all carry a session when authenticated; SIGNED_OUT clears.
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT") {
        userIdRef.current = null;
        setUser(null);
        setIsLoading(false);
        return;
      }
      applySession(session);
    });

    // Fallback for environments where onAuthStateChange does not emit an
    // INITIAL_SESSION event: read the persisted session directly. Deferred so
    // it cannot race the auth lock held by the callback above.
    setTimeout(() => {
      if (cancelled) return;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (cancelled) return;
        if (session?.user) {
          if (userIdRef.current !== session.user.id) applySession(session);
        } else if (!userIdRef.current) {
          setIsLoading(false);
        }
      });
    }, 0);

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    userIdRef.current = null;
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const id = userIdRef.current;
    if (!id) return;
    await loadProfile(id);
  }, [loadProfile]);

  const applyUser = useCallback((next: Profile) => {
    setUser((prev) => (prev ? ({ ...prev, ...next } as Profile) : next));
  }, []);

  return (
    <AuthContext.Provider
      value={{ user, isLoading, signOut, refreshUser, applyUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
