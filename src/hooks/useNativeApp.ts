"use client";
// src/hooks/useNativeApp.ts
//
// React hook that exposes native-app detection to client components.
// Resolves after first render to avoid hydration mismatches — the server
// always sees "web"; the client reads the real value on mount.

import { useEffect, useState } from "react";
import { getNativePlatform, type NativePlatform } from "@/lib/native-app";

export interface NativeAppState {
  /** The resolved platform: "ios", "android", or "web". */
  platform: NativePlatform;
  /** True while the platform hasn't been resolved client-side yet. */
  loading: boolean;
  /** Convenience: true when platform === "ios". */
  isIOS: boolean;
  /** Convenience: true when platform !== "web". */
  isNative: boolean;
  /**
   * True when digital-goods purchase UI should be hidden.
   * Currently means iOS only (Apple rule 3.1.1).
   * Android keeps the normal Stripe flow.
   */
  hidePurchaseUI: boolean;
}

export function useNativeApp(): NativeAppState {
  const [platform, setPlatform] = useState<NativePlatform>("web");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPlatform(getNativePlatform());
    setLoading(false);
  }, []);

  return {
    platform,
    loading,
    isIOS: platform === "ios",
    isNative: platform !== "web",
    hidePurchaseUI: platform === "ios",
  };
}
