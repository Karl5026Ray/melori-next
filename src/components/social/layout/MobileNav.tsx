"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Radio,
  MessagesSquare,
  MessageSquare,
  Compass,
  User,
  Plus,
  Hand,
  Home,
  Music,
} from "lucide-react";

// Order mirrors the desktop Sidebar so mobile and desktop stay in sync:
// MM Social (brand) -> Profile -> Spaces -> Community -> Messages -> Waves -> Video -> Back
const mobileItems = [
  { href: "/social/profile", label: "Profile", icon: User },
  { href: "/social/spaces", label: "Spaces", icon: Radio },
  { href: "/social/community", label: "Community", icon: MessagesSquare },
  {
    href: "/social/spaces/create",
    label: "Create",
    icon: Plus,
    isAction: true,
  },
  { href: "/social/messages", label: "Messages", icon: MessageSquare },
  { href: "/social/waves", label: "Waves", icon: Hand },
  { href: "/social/video", label: "Video", icon: Compass },
  { href: "/", label: "Back", icon: Home },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <div className="md:hidden fixed bottom-0 left-0 right-0 z-50">
      {/* MM Social brand strip */}
      <div className="flex items-center gap-2 px-4 py-1.5 bg-melori-void/95 backdrop-blur border-t border-melori-border">
        <div className="w-5 h-5 rounded-md bg-gradient-to-br from-melori-purple to-melori-pink flex items-center justify-center">
          <Music className="w-3 h-3 text-white" />
        </div>
        <span className="text-xs font-bold tracking-tight">MM Social</span>
      </div>

      {/* Navigation bar */}
      <nav className="h-16 mobile-nav-gradient flex items-center justify-between z-50 px-1 pb-2">
        {mobileItems.map((item) => {
          const isActive =
            !item.isAction &&
            (item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href));
          const Icon = item.icon;

          if (item.isAction) {
            return (
              <Link
                key={item.href}
                href={item.href}
                className="relative -top-5 p-3 btn-primary rounded-full shadow-lg shrink-0"
                aria-label={item.label}
              >
                <Icon className="w-6 h-6 text-white" />
              </Link>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 py-2 flex-1 min-w-0 transition ${
                isActive ? "text-melori-purple" : "text-melori-muted"
              }`}
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span className="text-[9px] font-medium leading-tight truncate max-w-full">
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
