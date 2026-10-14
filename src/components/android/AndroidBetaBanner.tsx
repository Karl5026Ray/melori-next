"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { X } from "lucide-react";
import { isNativeApp } from "@/lib/native-app";
import { BANNER_DISMISS_KEY, shouldShowAndroidBetaBanner } from "@/lib/androidBeta";

type ClientInfo = { userAgent: string; nativeApp: boolean; dismissed: boolean };

/**
 * A thin, dismissible strip for Android phones browsing the website — never
 * inside the native app (MeloriApp UA / window.Capacitor / data-native-app),
 * never on iOS or desktop, never on /android itself or /admin.
 *
 * Decided after mount only: the server render (and the first client render)
 * is always empty, so the ISR home page and the rest of the layout are not
 * made dynamic and there is no hydration mismatch.
 */
export default function AndroidBetaBanner() {
  const pathname = usePathname();
  const [info, setInfo] = useState<ClientInfo | null>(null);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = window.localStorage.getItem(BANNER_DISMISS_KEY) === "1";
    } catch {
      // storage blocked — show it; dismissal just won't stick
    }
    let nativeApp = false;
    try {
      nativeApp = isNativeApp() || document.documentElement.dataset.nativeApp === "1";
    } catch {
      nativeApp = false;
    }
    setInfo({ userAgent: navigator.userAgent, nativeApp, dismissed });
  }, []);

  if (!info || !shouldShowAndroidBetaBanner({ ...info, pathname })) return null;

  const dismiss = () => {
    setInfo({ ...info, dismissed: true });
    try {
      window.localStorage.setItem(BANNER_DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  return (
    <div
      data-android-beta-banner
      className="bg-brand-surface border-b border-brand-border text-sm"
    >
      <div className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
        <Link
          href="/android?src=banner"
          className="flex-1 min-w-0 text-[13px] leading-snug text-text-secondary hover:text-text-primary"
        >
          Get the Melori Android app early{" "}
          <span className="font-semibold text-brand-primary">→ Join the beta</span>
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 rounded-full p-1.5 text-text-secondary hover:bg-white/5 hover:text-text-primary"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
