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
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", id)
      .single();
    if (data) {
      setUser({
        ...data,
        display_name: data.display_name || data.full_name || data.username,
      } as Profile);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.user) {
        userIdRef.current = session.user.id;
        await loadProfile(session.user.id);
      }
      setIsLoading(false);
    };
    init();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session?.user) {
        userIdRef.current = session.user.id;
        await loadProfile(session.user.id);
      } else {
        userIdRef.current = null;
        setUser(null);
      }
    });

    return () => subscription.unsubscribe();
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
