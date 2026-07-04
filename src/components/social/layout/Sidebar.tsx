"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/social/providers/AuthProvider";
import {
  Radio,
  MessageSquare,
  Compass,
  User,
  LogOut,
  Music,
  Plus,
  Home,
  MessagesSquare,
  Hand,
} from "lucide-react";

const navItems = [
  { href: "/social/spaces", label: "Spaces", icon: Radio },
  { href: "/social/community", label: "Community", icon: MessagesSquare },
  { href: "/social/messages", label: "Messages", icon: MessageSquare },
  { href: "/social/waves", label: "Waves", icon: Hand },
  { href: "/social/video", label: "Video", icon: Compass },
  { href: "/social/profile", label: "Profile", icon: User },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  return (
    <aside className="hidden md:flex w-64 flex-col border-r border-melori-border bg-melori-void z-20 shrink-0">
      <div className="p-6 pb-4">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-melori-purple to-melori-pink flex items-center justify-center shadow-lg">
            <Music className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg tracking-tight">MM Social</h1>
            <p className="text-xs text-melori-muted">Spaces &amp; more</p>
          </div>
        </div>

        <Link
          href="/social/spaces/create"
          className="btn-primary w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg mb-6"
        >
          <Plus className="w-4 h-4" />
          Start a Space
        </Link>

        <nav className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition font-medium text-sm ${
                  isActive
                    ? "bg-melori-purple/10 text-melori-purple"
                    : "text-melori-muted hover:bg-melori-elevated hover:text-melori-text"
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/"
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition font-medium text-sm text-melori-muted hover:bg-melori-elevated hover:text-melori-text"
          >
            <Home className="w-5 h-5" />
            Back to MELORI
          </Link>
        </nav>
      </div>

      <div className="mt-auto p-4 border-t border-melori-border">
        {user ? (
          <div className="space-y-3">
            <div className="glass rounded-xl p-3 flex items-center gap-3">
              <img
                src={user.avatar_url || "/favicon.png"}
                className="w-10 h-10 rounded-full border-2 border-melori-purple object-cover"
                alt={user.display_name}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">
                  {user.display_name}
                </p>
                <p className="text-xs text-melori-purple flex items-center gap-1 capitalize">
                  <span className="w-1.5 h-1.5 rounded-full bg-melori-purple" />
                  {user.role}
                </p>
              </div>
            </div>
            <button
              onClick={signOut}
              className="w-full p-2 hover:bg-red-500/10 rounded-lg transition flex items-center justify-center gap-2 text-xs text-melori-muted hover:text-red-400"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        ) : (
          <Link
            href="/social/auth"
            className="btn-primary w-full py-3 rounded-xl font-semibold text-sm text-center block"
          >
            Sign In
          </Link>
        )}
      </div>
    </aside>
  );
}
