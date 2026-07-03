"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Section = "overview" | "releases" | "tracks" | "videos" | "members" | "orders" | "revenue" | "artists" | "donors" | "settings" | "health";

interface DashboardStats {
  totalRevenue: number;
  totalOrders: number;
  totalMembers: number;
  totalTracks: number;
  totalReleases: number;
  recentOrders: any[];
}

export default function AdminDashboardPage() {
  const [section, setSection] = useState<Section>("overview");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminName, setAdminName] = useState("Admin");
  const router = useRouter();

  useEffect(() => {
    // Verify session
    fetch("/api/admin/session")
      .then((r) => r.json())
      .then((data) => {
        if (!data.authenticated) {
          router.push("/admin");
        }
      });

    // Load stats
    fetch("/api/admin/stats")
      .then((r) => r.json())
      .then((data) => {
        setStats(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [router]);

  const handleLogout = async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    router.push("/admin");
  };

  const navItems: { id: Section; label: string; icon: string }[] = [
    { id: "overview", label: "Overview", icon: "📊" },
    { id: "releases", label: "Releases", icon: "💿" },
    { id: "tracks", label: "Tracks", icon: "🎵" },
    { id: "videos", label: "Videos", icon: "🎬" },
    { id: "members", label: "Members", icon: "👥" },
    { id: "orders", label: "Orders", icon: "📦" },
    { id: "revenue", label: "Revenue", icon: "💰" },
    { id: "artists", label: "Artists", icon: "🎤" },
    { id: "donors", label: "Donors", icon: "💛" },
    { id: "settings", label: "Settings", icon: "⚙️" },
    { id: "health", label: "Health", icon: "🩺" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-[#c9a96e]/20 border-t-[#c9a96e] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white flex">
      {/* Sidebar */}
      <aside className="w-64 bg-[#0d0d0d] border-r border-white/[0.06] flex flex-col">
        <div className="p-6 border-b border-white/[0.06]">
          <Link href="/" className="flex items-center gap-2">
            <span className="text-xl">🎵</span>
            <span className="font-bold text-lg">MELORI Admin</span>
          </Link>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setSection(item.id)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all cursor-pointer
                ${section === item.id
                  ? "bg-[#c9a96e]/15 text-[#c9a96e]"
                  : "text-[#888] hover:bg-white/5 hover:text-white"
                }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="p-4 border-t border-white/[0.06]">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#c9a96e] to-[#a08050] flex items-center justify-center text-xs font-bold text-[#0a0a0a]">
              KR
            </div>
            <div>
              <p className="text-sm font-medium">{adminName}</p>
              <p className="text-xs text-[#666]">Owner</p>
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="w-full py-2 text-sm text-[#888] hover:text-red-400 transition-colors text-left cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <header className="bg-[#0d0d0d] border-b border-white/[0.06] px-8 py-4 flex items-center justify-between">
          <h1 className="text-xl font-bold">
            {navItems.find((n) => n.id === section)?.label}
          </h1>
          <div className="flex items-center gap-4">
            <span className="text-xs text-[#666]">
              {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            </span>
            <Link
              href="/"
              target="_blank"
              className="text-xs text-[#c9a96e] hover:underline"
            >
              View Site →
            </Link>
          </div>
        </header>

        <div className="p-8">
          {section === "overview" && <OverviewSection stats={stats} />}
          {section === "releases" && <ReleasesSection />}
          {section === "tracks" && <TracksSection />}
          {section === "videos" && <VideosSection />}
          {section === "members" && <MembersSection />}
          {section === "orders" && <OrdersSection />}
          {section === "revenue" && <RevenueSection />}
          {section === "artists" && <ArtistsSection />}
          {section === "donors" && <DonorsSection />}
          {section === "settings" && <SettingsSection />}
          {section === "health" && <HealthSection />}
        </div>
      </main>
    </div>
  );
}

// Placeholder sections — full implementations would be separate components
function OverviewSection({ stats }: { stats: DashboardStats | null }) {
  const cards = [
    { label: "Total Revenue", value: `$${(stats?.totalRevenue || 0).toFixed(2)}`, icon: "💰", color: "text-[#c9a96e]" },
    { label: "Total Orders", value: stats?.totalOrders || 0, icon: "📦", color: "text-white" },
    { label: "Members", value: stats?.totalMembers || 0, icon: "👥", color: "text-white" },
    { label: "Tracks", value: stats?.totalTracks || 0, icon: "🎵", color: "text-white" },
    { label: "Releases", value: stats?.totalReleases || 0, icon: "💿", color: "text-white" },
    { label: "Recent Activity", value: stats?.recentOrders?.length || 0, icon: "🔔", color: "text-white" },
  ];

  return (
    <div className="space-y-6">
      <div className="grid md:grid-cols-3 gap-4">
        {cards.map((card) => (
          <div key={card.label} className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-2">
              <span className="text-2xl">{card.icon}</span>
              <span className="text-sm text-[#888]">{card.label}</span>
            </div>
            <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="font-semibold mb-4">Quick Actions</h3>
        <div className="flex gap-3 flex-wrap">
          <button className="px-4 py-2 bg-[#c9a96e]/15 text-[#c9a96e] rounded-lg text-sm font-medium hover:bg-[#c9a96e]/25 transition-all cursor-pointer">
            + New Release
          </button>
          <button className="px-4 py-2 bg-white/5 text-[#ccc] rounded-lg text-sm font-medium hover:bg-white/10 transition-all cursor-pointer">
            + New Track
          </button>
          <button className="px-4 py-2 bg-white/5 text-[#ccc] rounded-lg text-sm font-medium hover:bg-white/10 transition-all cursor-pointer">
            + New Video
          </button>
          <button className="px-4 py-2 bg-white/5 text-[#ccc] rounded-lg text-sm font-medium hover:bg-white/10 transition-all cursor-pointer">
            Export Data
          </button>
        </div>
      </div>
    </div>
  );
}

function ReleasesSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold">All Releases</h3>
        <button className="px-4 py-2 bg-[#c9a96e]/15 text-[#c9a96e] rounded-lg text-sm font-medium cursor-pointer">
          + New Release
        </button>
      </div>
      <p className="text-[#888]">Release management table would render here with CRUD operations.</p>
    </div>
  );
}

function TracksSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold">All Tracks</h3>
        <button className="px-4 py-2 bg-[#c9a96e]/15 text-[#c9a96e] rounded-lg text-sm font-medium cursor-pointer">
          + New Track
        </button>
      </div>
      <p className="text-[#888]">Track management table with audio upload, metadata edit, preview clip settings.</p>
    </div>
  );
}

function VideosSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold">All Videos</h3>
        <button className="px-4 py-2 bg-[#c9a96e]/15 text-[#c9a96e] rounded-lg text-sm font-medium cursor-pointer">
          + New Video
        </button>
      </div>
      <p className="text-[#888]">Video management with YouTube embeds and hosted videos.</p>
    </div>
  );
}

function MembersSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <h3 className="font-semibold mb-4">Members</h3>
      <p className="text-[#888]">Member list from Stripe subscriptions with tier, status, and management actions.</p>
    </div>
  );
}

function OrdersSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <h3 className="font-semibold mb-4">Orders</h3>
      <p className="text-[#888]">All purchases with refund capability and export to CSV.</p>
    </div>
  );
}

function RevenueSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <h3 className="font-semibold mb-4">Revenue Dashboard</h3>
      <p className="text-[#888]">70/30 split visualization, monthly trends, artist payouts owed.</p>
    </div>
  );
}

function ArtistsSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <h3 className="font-semibold mb-4">Artists</h3>
      <p className="text-[#888]">Artist profiles, revenue per artist, payout management.</p>
    </div>
  );
}

function DonorsSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <h3 className="font-semibold mb-4">Donors</h3>
      <p className="text-[#888]">Donation history with donor details and export.</p>
    </div>
  );
}

function SettingsSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <h3 className="font-semibold mb-4">Site Settings</h3>
      <p className="text-[#888]">Homepage management, pricing tiers, legal pages, password change.</p>
    </div>
  );
}

function HealthSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <h3 className="font-semibold mb-4">System Health</h3>
      <p className="text-[#888]">Real-time status of Supabase, Stripe, Resend, DNS, storage.</p>
    </div>
  );
}
