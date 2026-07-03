"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Radio, MessageSquare, Compass, User, Plus } from "lucide-react";

const mobileItems = [
  { href: "/social/spaces", label: "Spaces", icon: Radio },
  { href: "/social/messages", label: "Messages", icon: MessageSquare },
  {
    href: "/social/spaces/create",
    label: "Create",
    icon: Plus,
    isAction: true,
  },
  { href: "/social/video", label: "Video", icon: Compass },
  { href: "/social/profile", label: "Profile", icon: User },
];

export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 mobile-nav-gradient flex items-center justify-around z-50 px-2 pb-2">
      {mobileItems.map((item) => {
        const isActive = pathname.startsWith(item.href) && !item.isAction;
        const Icon = item.icon;

        if (item.isAction) {
          return (
            <Link
              key={item.href}
              href={item.href}
              className="relative -top-5 p-3 btn-primary rounded-full shadow-lg"
            >
              <Icon className="w-6 h-6 text-white" />
            </Link>
          );
        }

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-0.5 p-2 transition ${
              isActive ? "text-melori-purple" : "text-melori-muted"
            }`}
          >
            <Icon className="w-6 h-6" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
