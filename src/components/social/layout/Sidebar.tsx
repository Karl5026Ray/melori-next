"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/social/providers/AuthProvider";
import {
  Radio,
  Video,
  MessageSquare,
  MessagesSquare,
  User,
  LogOut,
  Home,
  Plus,
} from "lucide-react";

// Slimmed, orange-branded social nav. We keep only the destinations people
// actually use day to day; Waves and the standalone Video page are reachable
// from within Community/Faces and the mobile launcher, so they no longer clutter
// this rail. Brand orange (#ff5500) replaces the old purple accents.
const navItems = [
  { href: "/social/profile", label: "Profile", icon: User },
  { href: "/social/spaces", label: "MM Spaces", icon: Radio },
  { href: "/social/live", label: "MM Faces", icon: Video },
  { href: "/social/community", label: "Community", icon: MessagesSquare },
  { href: "/social/messages", label: "Messages", icon: MessageSquare },
];

export function Sidebar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();

  return (
    <aside className="hidden md:flex w-60 flex-col border-r border-brand-border bg-brand-background z-20 shrink-0">
      <div className="p-6 pb-4">
        <Link href="/" className="flex items-center gap-3 mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo/logo.png" alt="Melori" className="w-10 h-10 object-contain" />
          <div>
            <h1 className="font-bold text-lg tracking-tight text-text-primary">
              MM Social
            </h1>
            <p className="text-xs text-text-secondary">Spaces &amp; Faces</p>
          </div>
        </Link>

        <Link
          href="/social/live"
          className="w-full py-3 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 shadow-lg mb-6 bg-brand-primary text-white transition-colors hover:bg-brand-primary-dark"
        >
          <Plus className="w-4 h-4" />
          Go Live
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
                    ? "bg-brand-primary/10 text-brand-primary"
                    : "text-text-secondary hover:bg-brand-surface hover:text-text-primary"
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
          <Link
            href="/"
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition font-medium text-sm text-text-secondary hover:bg-brand-surface hover:text-text-primary"
          >
            <Home className="w-5 h-5" />
            Back to Melori
          </Link>
        </nav>
      </div>

      <div className="mt-auto p-4 border-t border-brand-border">
        {user ? (
          <div className="space-y-3">
            <div className="rounded-xl p-3 flex items-center gap-3 bg-brand-surface">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={user.avatar_url || "/favicon.png"}
                className="w-10 h-10 rounded-full border-2 border-brand-primary object-cover"
                alt={user.display_name}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate text-text-primary">
                  {user.display_name}
                </p>
                <p className="text-xs text-brand-primary flex items-center gap-1 capitalize">
                  <span className="w-1.5 h-1.5 rounded-full bg-brand-primary" />
                  {user.role}
                </p>
              </div>
            </div>
            <button
              onClick={signOut}
              className="w-full p-2 hover:bg-red-500/10 rounded-lg transition flex items-center justify-center gap-2 text-xs text-text-secondary hover:text-red-400"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
          </div>
        ) : (
          <Link
            href="/social/auth"
            className="w-full py-3 rounded-xl font-semibold text-sm text-center block bg-brand-primary text-white transition-colors hover:bg-brand-primary-dark"
          >
            Sign In
          </Link>
        )}
      </div>
    </aside>
  );
}
