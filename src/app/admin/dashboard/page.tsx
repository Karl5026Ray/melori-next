"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import CoverImage from "@/components/CoverImage";
import { authFetch } from "@/lib/authClient";

type Section =
  | "overview"
  | "releases"
  | "tracks"
  | "videos"
  | "members"
  | "orders"
  | "revenue"
  | "artists"
  | "users"
  | "submissions"
  | "moderation"
  | "donors"
  | "settings"
  | "health";

interface DashboardStats {
  totalRevenue: number;
  totalOrders: number;
  totalMembers: number;
  totalTracks: number;
  totalReleases: number;
  totalArtists?: number;
  totalSpaces?: number;
  pendingSubmissions?: number;
  memberBreakdown?: Record<string, number>;
  recentOrders: any[];
}

// Only expose Supabase-served http(s) URLs in the moderation preview link.
// Historical submissions rows could hold `javascript:` / `data:` values from
// before R13 tightened the /api/artist/submissions POST validator, and an
// admin clicking Preview would then execute the payload in their session.
function safeHttpHref(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 2048) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

export default function AdminDashboardPage() {
  const [section, setSection] = useState<Section>("overview");
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [adminName, setAdminName] = useState("Admin");
  // Controls the mobile slide-out drawer. Ignored on lg+ where the sidebar is
  // always visible.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const router = useRouter();

  // Lock body scroll while the mobile drawer is open so the page behind it
  // doesn't scroll under the overlay.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.style.overflow = sidebarOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [sidebarOpen]);

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
    { id: "users", label: "Users & Artists", icon: "👤" },
    { id: "submissions", label: "Upload Queue", icon: "📥" },
    { id: "moderation", label: "Moderation", icon: "🛡️" },
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
    <div className="min-h-screen bg-[#0a0a0a] text-white lg:flex">
      {/* Mobile top bar — only shown below lg. Holds the hamburger + title. */}
      <div className="lg:hidden sticky top-0 z-30 flex items-center gap-3 bg-[#0d0d0d] border-b border-white/[0.06] px-4 h-14">
        <button
          type="button"
          onClick={() => setSidebarOpen(true)}
          aria-label="Open menu"
          aria-expanded={sidebarOpen}
          className="p-2 -ml-2 rounded-lg text-[#ccc] hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
        >
          {/* hamburger */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <span className="text-base font-bold truncate">
          {navItems.find((n) => n.id === section)?.label ?? "MELORI Admin"}
        </span>
      </div>

      {/* Mobile overlay — click to dismiss the drawer. */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 bg-black/60 z-40"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — a slide-out drawer below lg, a static column at lg+. */}
      <aside
        className={`bg-[#0d0d0d] border-r border-white/[0.06] flex flex-col
          fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform duration-300 ease-out overflow-y-auto
          lg:static lg:z-auto lg:w-64 lg:max-w-none lg:translate-x-0 lg:transition-none
          ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <div className="p-6 border-b border-white/[0.06] flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2" onClick={() => setSidebarOpen(false)}>
            <span className="text-xl">🎵</span>
            <span className="font-bold text-lg">MELORI Admin</span>
          </Link>
          {/* Close button — mobile only. */}
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
            className="lg:hidden p-2 -mr-2 rounded-lg text-[#888] hover:bg-white/5 hover:text-white transition-colors cursor-pointer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="6" y1="6" x2="18" y2="18" />
              <line x1="6" y1="18" x2="18" y2="6" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setSection(item.id);
                setSidebarOpen(false);
              }}
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

          <div className="pt-4 mt-4 border-t border-white/[0.06] space-y-1">
            <p className="px-4 pb-1 text-[10px] uppercase tracking-wider text-[#555]">
              Tools
            </p>
            <Link
              href="/admin/tracks"
              onClick={() => setSidebarOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#888] hover:bg-white/5 hover:text-white transition-all"
            >
              <span>🎚️</span>
              Music Manager
            </Link>
            <Link
              href="/admin/uploads"
              onClick={() => setSidebarOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#888] hover:bg-white/5 hover:text-white transition-all"
            >
              <span>📤</span>
              Uploads Collection
            </Link>
            <Link
              href="/admin/releases"
              onClick={() => setSidebarOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#888] hover:bg-white/5 hover:text-white transition-all"
            >
              <span>💿</span>
              Release Manager
            </Link>
            <Link
              href="/admin/artists"
              onClick={() => setSidebarOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#888] hover:bg-white/5 hover:text-white transition-all"
            >
              <span>🎤</span>
              Artist Manager
            </Link>
            <Link
              href="/admin/email-blast"
              onClick={() => setSidebarOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#888] hover:bg-white/5 hover:text-white transition-all"
            >
              <span>✉️</span>
              Email Blast
            </Link>
            <Link
              href="/admin/sms-blast"
              onClick={() => setSidebarOpen(false)}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-[#888] hover:bg-white/5 hover:text-white transition-all"
            >
              <span>💬</span>
              SMS Blast
            </Link>
          </div>
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
      <main className="flex-1 overflow-auto min-w-0">
        {/* Desktop header — hidden on mobile where the top bar already shows the
            section title. */}
        <header className="hidden lg:flex bg-[#0d0d0d] border-b border-white/[0.06] px-8 py-4 items-center justify-between">
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

        <div className="p-4 sm:p-6 lg:p-8">
          {section === "overview" && <OverviewSection stats={stats} />}
          {section === "users" && <UsersSection />}
          {section === "submissions" && <SubmissionsSection />}
          {section === "moderation" && <ModerationSection />}
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
  const [seeding, setSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  const cards = [
    {
      label: "Total Revenue",
      value: `$${(stats?.totalRevenue || 0).toFixed(2)}`,
      icon: "💰",
      color: "text-[#c9a96e]",
    },
    { label: "Total Orders", value: stats?.totalOrders || 0, icon: "📦", color: "text-white" },
    { label: "Members", value: stats?.totalMembers || 0, icon: "👥", color: "text-white" },
    { label: "Tracks", value: stats?.totalTracks || 0, icon: "🎵", color: "text-white" },
    { label: "Releases", value: stats?.totalReleases || 0, icon: "💿", color: "text-white" },
    { label: "Artists", value: stats?.totalArtists ?? 0, icon: "🎤", color: "text-white" },
    { label: "Social Spaces", value: stats?.totalSpaces ?? 0, icon: "🗣️", color: "text-white" },
    {
      label: "Pending Submissions",
      value: stats?.pendingSubmissions ?? 0,
      icon: "📥",
      color: (stats?.pendingSubmissions ?? 0) > 0 ? "text-orange-400" : "text-white",
    },
    { label: "Recent Activity", value: stats?.recentOrders?.length || 0, icon: "🔔", color: "text-white" },
  ];

  const handleSeed = async () => {
    if (!confirm("Seed demo MM Social spaces + community posts? This is idempotent.")) return;
    setSeeding(true);
    setSeedMsg(null);
    try {
      const res = await fetch("/api/admin/seed-social", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Seed failed");
      setSeedMsg(
        `Seeded: ${data.spacesCreated ?? 0} new spaces, ${data.postsCreated ?? 0} new posts.`,
      );
    } catch (err: any) {
      setSeedMsg(err.message ?? "Seed failed");
    } finally {
      setSeeding(false);
    }
  };

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
          <Link
            href="/admin/releases"
            className="px-4 py-2 bg-[#c9a96e]/15 text-[#c9a96e] rounded-lg text-sm font-medium hover:bg-[#c9a96e]/25 transition-all cursor-pointer"
          >
            + New Track
          </Link>
          <Link
            href="/admin/artists"
            className="px-4 py-2 bg-white/5 text-[#ccc] rounded-lg text-sm font-medium hover:bg-white/10 transition-all cursor-pointer"
          >
            + New Artist
          </Link>
          <Link
            href="/settings#artist-banner"
            className="px-4 py-2 bg-white/5 text-[#ccc] rounded-lg text-sm font-medium hover:bg-white/10 transition-all cursor-pointer"
          >
            Edit My Banner
          </Link>
          <Link
            href="/admin/email-blast"
            className="px-4 py-2 bg-white/5 text-[#ccc] rounded-lg text-sm font-medium hover:bg-white/10 transition-all cursor-pointer"
          >
            Email Blast
          </Link>
          <Link
            href="/admin/sms-blast"
            className="px-4 py-2 bg-white/5 text-[#ccc] rounded-lg text-sm font-medium hover:bg-white/10 transition-all cursor-pointer"
          >
            SMS Blast
          </Link>
          <button
            onClick={handleSeed}
            disabled={seeding}
            className="px-4 py-2 bg-purple-500/15 text-purple-300 rounded-lg text-sm font-medium hover:bg-purple-500/25 transition-all cursor-pointer disabled:opacity-50"
          >
            {seeding ? "Seeding…" : "🌱 Seed MM Social Demo"}
          </button>
        </div>
        {seedMsg && (
          <p className="mt-3 text-xs text-[#888]">{seedMsg}</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Users & Artists
// ---------------------------------------------------------------------------
type AdminUser = {
  id: string;
  username: string | null;
  display_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  role: string | null;
  membership_tier: string | null;
  membership_status: string | null;
  verified: boolean | null;
  created_at: string;
};

function UsersSection() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (role) params.set("role", role);
    params.set("limit", "100");
    const res = await fetch(`/api/admin/users?${params.toString()}`);
    const data = await res.json().catch(() => ({}));
    setUsers(data.users ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = async (id: string, body: Record<string, any>) => {
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "Update failed");
      } else {
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h3 className="font-semibold">Users &amp; Artists</h3>
        <div className="flex items-center gap-2">
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Search email / username…"
            className="bg-black/60 border border-white/10 rounded-lg px-3 py-1.5 text-xs w-56"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="bg-black/60 border border-white/10 rounded-lg px-2 py-1.5 text-xs"
          >
            <option value="">All roles</option>
            <option value="user">User</option>
            <option value="artist">Artist</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={load}
            className="px-3 py-1.5 rounded-lg bg-[#c9a96e]/15 text-[#c9a96e] text-xs font-medium"
          >
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-[#888] text-sm">Loading…</p>
      ) : users.length === 0 ? (
        <p className="text-[#888] text-sm">No users found.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-[#888] uppercase">
              <tr>
                <th className="text-left py-2 px-2">User</th>
                <th className="text-left py-2 px-2">Role</th>
                <th className="text-left py-2 px-2">Tier</th>
                <th className="text-left py-2 px-2">Status</th>
                <th className="text-left py-2 px-2">Verified</th>
                <th className="text-right py-2 px-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-white/[0.06]">
                  <td className="py-2 px-2">
                    <div className="font-medium">{u.display_name || u.username || "—"}</div>
                    <div className="text-xs text-[#666]">@{u.username ?? "—"}</div>
                  </td>
                  <td className="py-2 px-2">
                    <select
                      value={u.role ?? "user"}
                      onChange={(e) => patch(u.id, { role: e.target.value })}
                      disabled={busy === u.id}
                      className="bg-black/60 border border-white/10 rounded px-2 py-1 text-xs"
                    >
                      <option value="user">user</option>
                      <option value="artist">artist</option>
                      <option value="admin">admin</option>
                    </select>
                  </td>
                  <td className="py-2 px-2 capitalize text-[#ccc]">{u.membership_tier ?? "—"}</td>
                  <td className="py-2 px-2 text-[#ccc]">{u.membership_status ?? "—"}</td>
                  <td className="py-2 px-2">
                    <button
                      onClick={() => patch(u.id, { verified: !u.verified })}
                      disabled={busy === u.id}
                      className={`text-xs px-2 py-1 rounded ${
                        u.verified
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-white/5 text-[#888]"
                      }`}
                    >
                      {u.verified ? "✓ Verified" : "Verify"}
                    </button>
                  </td>
                  <td className="py-2 px-2 text-right">
                    <span className="text-xs text-[#666]">
                      {new Date(u.created_at).toLocaleDateString()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload Queue (track submissions)
// ---------------------------------------------------------------------------
type Submission = {
  id: string;
  user_id: string;
  artist_id: number | null;
  title: string;
  release_type: string | null;
  genre: string | null;
  description: string | null;
  audio_url: string | null;
  cover_url: string | null;
  status: string;
  created_at: string;
  profile?: { display_name: string | null; username: string | null } | null;
  artist?: { name: string | null } | null;
};

function SubmissionsSection() {
  const [items, setItems] = useState<Submission[]>([]);
  const [status, setStatus] = useState("pending");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/submissions?status=${status}`);
    const data = await res.json().catch(() => ({}));
    setItems(data.submissions ?? []);
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const decide = async (id: string, action: "approve" | "reject") => {
    const note =
      action === "reject"
        ? prompt("Optional rejection reason (visible to artist):") ?? ""
        : "";
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/submissions/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, note }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "Action failed");
      } else {
        await load();
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h3 className="font-semibold">Upload Queue</h3>
        <div className="flex items-center gap-2">
          {["pending", "approved", "rejected", "all"].map((s) => (
            <button
              key={s}
              onClick={() => setStatus(s === "all" ? "" : s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${
                (status || "all") === s
                  ? "bg-[#c9a96e]/20 text-[#c9a96e]"
                  : "bg-white/5 text-[#888] hover:bg-white/10"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-[#888] text-sm">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-[#888] text-sm">No submissions in this state.</p>
      ) : (
        <div className="space-y-3">
          {items.map((s) => (
            <div
              key={s.id}
              className="flex items-start gap-4 p-4 bg-white/[0.02] border border-white/10 rounded-xl"
            >
              {s.cover_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={s.cover_url}
                  alt=""
                  className="w-16 h-16 rounded-lg object-cover border border-white/10"
                />
              ) : (
                <div className="w-16 h-16 rounded-lg bg-white/5 flex items-center justify-center text-2xl">
                  🎵
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold truncate">{s.title}</h4>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-[#ccc] uppercase">
                    {s.release_type ?? "single"}
                  </span>
                  {s.genre && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-[#ccc]">
                      {s.genre}
                    </span>
                  )}
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full uppercase ${
                      s.status === "pending"
                        ? "bg-orange-500/15 text-orange-300"
                        : s.status === "approved"
                          ? "bg-emerald-500/15 text-emerald-300"
                          : "bg-red-500/15 text-red-300"
                    }`}
                  >
                    {s.status}
                  </span>
                </div>
                <p className="text-xs text-[#888] mt-1">
                  by {s.artist?.name ?? s.profile?.display_name ?? s.profile?.username ?? "unknown"}
                  {" · "}
                  {new Date(s.created_at).toLocaleString()}
                </p>
                {s.description && (
                  <p className="text-sm text-[#ccc] mt-2 line-clamp-2">{s.description}</p>
                )}
                <div className="flex items-center gap-3 mt-2">
                  {(() => {
                    const href = safeHttpHref(s.audio_url);
                    return href ? (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-[#c9a96e] hover:underline"
                      >
                        ▶ Preview audio
                      </a>
                    ) : null;
                  })()}
                </div>
              </div>
              {s.status === "pending" && (
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => decide(s.id, "approve")}
                    disabled={busy === s.id}
                    className="px-3 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 text-xs font-medium hover:bg-emerald-500/25 disabled:opacity-50"
                  >
                    ✓ Approve
                  </button>
                  <button
                    onClick={() => decide(s.id, "reject")}
                    disabled={busy === s.id}
                    className="px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 text-xs font-medium hover:bg-red-500/25 disabled:opacity-50"
                  >
                    ✕ Reject
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Moderation (community comments)
// ---------------------------------------------------------------------------
type Comment = {
  id: string;
  body: string;
  author_name: string | null;
  user_id: string | null;
  created_at: string;
};

function ModerationSection() {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    const res = await fetch("/api/admin/moderation/comments");
    if (res.ok) {
      const data = await res.json();
      setComments(data.comments ?? []);
    } else {
      setComments([]);
    }
    setLoading(false);
  };

  useEffect(() => {
    load();
  }, []);

  const remove = async (id: string) => {
    if (!confirm("Delete this comment? This cannot be undone.")) return;
    setBusy(id);
    try {
      const res = await fetch(`/api/admin/moderation/comments/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        alert(d.error ?? "Delete failed");
      } else {
        setComments((prev) => prev.filter((c) => c.id !== id));
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold">Community Moderation</h3>
        <button
          onClick={load}
          className="px-3 py-1.5 rounded-lg bg-[#c9a96e]/15 text-[#c9a96e] text-xs font-medium"
        >
          Refresh
        </button>
      </div>

      <Link
        href="/admin/moderation"
        className="mb-4 flex items-center justify-between rounded-xl border border-[#ff5500]/40 bg-[#ff5500]/10 px-4 py-3 text-sm font-semibold text-[#ff5500] hover:bg-[#ff5500]/20"
      >
        <span>🛡️ Content safety queue — quarantined media &amp; user reports</span>
        <span aria-hidden>→</span>
      </Link>

      {loading ? (
        <p className="text-[#888] text-sm">Loading…</p>
      ) : comments.length === 0 ? (
        <p className="text-[#888] text-sm">No comments to moderate.</p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => (
            <div
              key={c.id}
              className="flex items-start justify-between gap-4 p-4 bg-white/[0.02] border border-white/10 rounded-xl"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm">{c.body}</p>
                <p className="text-xs text-[#666] mt-1">
                  by {c.author_name ?? "anon"} ·{" "}
                  {new Date(c.created_at).toLocaleString()}
                </p>
              </div>
              <button
                onClick={() => remove(c.id)}
                disabled={busy === c.id}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-red-500/15 text-red-300 text-xs font-medium hover:bg-red-500/25 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReleasesSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold">All Releases</h3>
        <Link
          href="/admin/releases"
          className="px-4 py-2 bg-[#c9a96e]/15 text-[#c9a96e] rounded-lg text-sm font-medium cursor-pointer hover:bg-[#c9a96e]/25"
        >
          Open Release Manager →
        </Link>
      </div>
      <p className="text-[#888] mb-4">
        View every album and single with its full track list, and delete
        releases or individual tracks.
      </p>
      <Link
        href="/admin/releases"
        className="inline-block px-5 py-3 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl"
      >
        Manage Releases
      </Link>
    </div>
  );
}

function TracksSection() {
  return (
    <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold">All Tracks</h3>
        <Link
          href="/admin/releases"
          className="px-4 py-2 bg-[#c9a96e]/15 text-[#c9a96e] rounded-lg text-sm font-medium cursor-pointer hover:bg-[#c9a96e]/25"
        >
          Open Music Manager →
        </Link>
      </div>
      <p className="text-[#888] mb-4">
        Upload catalog audio, edit metadata, set the 30-second sample window, and
        publish or unpublish tracks.
      </p>
      <Link
        href="/admin/tracks"
        className="inline-block px-5 py-3 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl"
      >
        Manage Tracks
      </Link>
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
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-semibold">Artists</h3>
        <Link
          href="/admin/artists"
          className="px-4 py-2 bg-[#c9a96e]/15 text-[#c9a96e] rounded-lg text-sm font-medium cursor-pointer hover:bg-[#c9a96e]/25"
        >
          Open Artist Manager →
        </Link>
      </div>
      <p className="text-[#888] mb-4">
        Create and edit artist profiles — name, bio, photo, verified and published
        status.
      </p>
      <Link
        href="/admin/artists"
        className="inline-block px-5 py-3 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl"
      >
        Manage Artists
      </Link>
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

// Admin self-service profile control. Reuses the same social endpoints as the
// EditProfileModal: POST /api/social/profile/upload-url for the avatar and
// PATCH /api/social/profile for display_name/bio. Loads the admin's own profile
// from /api/user/me on mount.
function SettingsSection() {
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await authFetch("/api/user/me", { method: "GET" });
        if (!res.ok) return;
        const me = await res.json().catch(() => ({}) as any);
        if (cancelled) return;
        const p = me?.profile ?? {};
        setDisplayName(p.display_name || p.full_name || "");
        setBio(p.bio ?? "");
        setAvatarUrl(p.avatar_url ?? null);
      } catch {
        /* leave fields empty on failure */
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePickPhoto = () => fileInputRef.current?.click();

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Please choose an image file.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError("Photo must be 5 MB or smaller.");
      return;
    }
    setError(null);
    setSaved(false);
    setUploading(true);
    try {
      const urlRes = await authFetch("/api/social/profile/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });
      if (!urlRes.ok) {
        const d = await urlRes.json().catch(() => ({}));
        throw new Error(d.error ?? "Could not get upload URL");
      }
      const { signedUrl, publicUrl } = await urlRes.json();
      const putRes = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      });
      if (!putRes.ok) throw new Error("Upload failed — please try again.");
      setAvatarUrl(publicUrl);
    } catch (err: any) {
      setError(err?.message ?? "Photo upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleSave = async () => {
    setError(null);
    setSaved(false);
    const dn = displayName.trim();
    if (!dn) {
      setError("Display name is required.");
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch("/api/social/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: dn,
          bio: bio.trim() ? bio.trim() : null,
          avatar_url: avatarUrl,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Save failed");
      }
      setSaved(true);
      if (typeof window !== "undefined") {
        const { profile } = await res.json().catch(() => ({ profile: null }));
        if (profile) {
          window.dispatchEvent(
            new CustomEvent("melori:profile-updated", { detail: profile }),
          );
        }
      }
    } catch (err: any) {
      setError(err?.message ?? "Could not save profile.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* My Profile — admin self-service edit */}
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="font-semibold mb-4">My Profile</h3>
        {loading ? (
          <p className="text-[#888] text-sm">Loading…</p>
        ) : (
          <div className="space-y-4 max-w-xl">
            <div className="flex items-center gap-4">
              <button
                type="button"
                onClick={handlePickPhoto}
                disabled={uploading}
                aria-label="Change photo"
                className="w-20 h-20 shrink-0 overflow-hidden rounded-full border border-[#c9a96e]/30 disabled:opacity-50"
              >
                <CoverImage
                  src={avatarUrl}
                  alt={displayName || "Admin"}
                  name={displayName || "Admin"}
                  rounded="rounded-full"
                  className="w-full h-full"
                />
              </button>
              <div>
                <button
                  type="button"
                  onClick={handlePickPhoto}
                  disabled={uploading}
                  className="px-4 py-2 rounded-lg bg-white/5 border border-white/10 text-sm font-medium hover:bg-white/10 transition disabled:opacity-50"
                >
                  {uploading ? "Uploading…" : "Change photo"}
                </button>
                <p className="mt-1 text-xs text-[#666]">JPG or PNG, up to 5 MB.</p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleFileChange}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#888] mb-1">
                Display name
              </label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={50}
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a96e] transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wide text-[#888] mb-1">
                Bio
              </label>
              <textarea
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                rows={3}
                maxLength={500}
                placeholder="Say something about yourself…"
                className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-[#c9a96e] transition resize-none"
              />
              <p className="mt-1 text-xs text-[#666] text-right">{bio.length}/500</p>
            </div>

            {error && (
              <p className="rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-sm text-red-400">
                {error}
              </p>
            )}
            {saved && (
              <p className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-300">
                Profile saved.
              </p>
            )}

            <button
              type="button"
              onClick={handleSave}
              disabled={saving || uploading}
              className="px-6 py-2.5 rounded-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-semibold text-sm disabled:opacity-50 transition"
            >
              {saving ? "Saving…" : "Save profile"}
            </button>
          </div>
        )}
      </div>

      {/* Site Settings — placeholder sub-panel */}
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="font-semibold mb-4">Site Settings</h3>
        <p className="text-[#888]">Homepage management, pricing tiers, legal pages, password change.</p>
      </div>
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
