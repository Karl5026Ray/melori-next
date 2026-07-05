"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/social/layout/Sidebar";
import { MobileNav } from "@/components/social/layout/MobileNav";

// Routes within /social that should render WITHOUT the MM Social shell
// (no sidebar, no mobile nav, no MM Social branding). The login/auth page
// belongs here so MM Social is never featured on the login screen. MM Social
// stays accessible through the Community tab once the user is signed in.
const BARE_ROUTES = ["/social/auth"];

export function SocialShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isBare = BARE_ROUTES.some(
    (route) => pathname === route || pathname?.startsWith(route + "/")
  );

  if (isBare) {
    // Standalone view: just the page content, no MM Social chrome.
    return (
      <div className="flex min-h-[calc(100vh-4rem)] flex-col bg-melori-void text-melori-text">
        {children}
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-[calc(100vh-4rem)] bg-melori-void text-melori-text">
        <Sidebar />
        <div className="flex-1 flex flex-col relative">{children}</div>
      </div>
      <MobileNav />
    </>
  );
}
