"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

const NativeAppContext = createContext(false);

/** True only inside the iOS/Android Capacitor WebView. Always false on the web. */
export function useIsNativeApp(): boolean {
  return useContext(NativeAppContext);
}

export default function NativeAppProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isNativeApp, setIsNativeApp] = useState(false);

  useEffect(() => {
    setIsNativeApp(document.documentElement.dataset.nativeApp === "1");
  }, []);

  return (
    <NativeAppContext.Provider value={isNativeApp}>
      {children}
    </NativeAppContext.Provider>
  );
}
