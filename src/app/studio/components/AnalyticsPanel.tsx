"use client";

import { useState, useEffect } from "react";

interface Analytics {
  totalStreams: number;
  totalDownloads: number;
  totalRevenue: number;
  artistShare: number; // 70%
  platformShare: number; // 30%
  tracksCount: number;
  topTrack: { title: string; streams: number } | null;
  monthlyData: { month: string; revenue: number; streams: number }[];
}

export default function AnalyticsPanel() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState<"7d" | "30d" | "90d" | "all">("30d");

  useEffect(() => {
    fetch(`/api/studio/analytics?period=${period}`)
      .then((r) => r.json())
      .then((data) => {
        setAnalytics(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [period]);

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-10 h-10 border-3 border-[#c9a96e]/20 border-t-[#c9a96e] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#888]">Loading analytics...</p>
      </div>
    );
  }

  const stats = analytics || {
    totalStreams: 0,
    totalDownloads: 0,
    totalRevenue: 0,
    artistShare: 0,
    platformShare: 0,
    tracksCount: 0,
    topTrack: null,
    monthlyData: [],
  };

  return (
    <div className="space-y-8">
      {/* Period Selector */}
      <div className="flex gap-2">
        {(["7d", "30d", "90d", "all"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer
              ${period === p
                ? "bg-[#c9a96e]/15 text-[#c9a96e] border border-[#c9a96e]/30"
                : "bg-white/5 text-[#888] border border-white/10 hover:border-white/20"
              }`}
          >
            {p === "all" ? "All Time" : `Last ${p}`}
          </button>
        ))}
      </div>

      {/* Revenue Split Visualization */}
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="font-semibold mb-4">Revenue Split</h3>
        <div className="flex h-8 rounded-full overflow-hidden mb-3">
          <div
            className="bg-[#c9a96e] flex items-center justify-center text-xs font-bold text-[#0a0a0a]"
            style={{ width: "70%" }}
          >
            You: 70%
          </div>
          <div
            className="bg-white/10 flex items-center justify-center text-xs font-bold text-white"
            style={{ width: "30%" }}
          >
            Platform: 30%
          </div>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-[#c9a96e]">Your earnings: ${stats.artistShare.toFixed(2)}</span>
          <span className="text-[#888]">Platform fee: ${stats.platformShare.toFixed(2)}</span>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid md:grid-cols-4 gap-4">
        {[
          { label: "Total Streams", value: stats.totalStreams.toLocaleString(), icon: "▶️" },
          { label: "Downloads", value: stats.totalDownloads.toLocaleString(), icon: "⬇️" },
          { label: "Total Revenue", value: `$${stats.totalRevenue.toFixed(2)}`, icon: "💰" },
          { label: "Your Share (70%)", value: `$${stats.artistShare.toFixed(2)}`, icon: "🎤" },
        ].map((stat) => (
          <div key={stat.label} className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-5 text-center">
            <div className="text-2xl mb-2">{stat.icon}</div>
            <div className="text-2xl font-bold text-white">{stat.value}</div>
            <div className="text-xs text-[#888] mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Top Track */}
      {stats.topTrack && (
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
          <h3 className="font-semibold mb-3">Top Performing Track</h3>
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#c9a96e]/20 to-[#a08050]/20 flex items-center justify-center text-xl">
              🏆
            </div>
            <div>
              <p className="font-semibold">{stats.topTrack.title}</p>
              <p className="text-sm text-[#888]">{stats.topTrack.streams.toLocaleString()} streams</p>
            </div>
          </div>
        </div>
      )}

      {/* Monthly Chart Placeholder */}
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="font-semibold mb-4">Monthly Performance</h3>
        {stats.monthlyData.length > 0 ? (
          <div className="space-y-3">
            {stats.monthlyData.map((m) => (
              <div key={m.month} className="flex items-center gap-4">
                <span className="text-sm text-[#888] w-20">{m.month}</span>
                <div className="flex-1 h-6 bg-white/5 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-[#c9a96e] to-[#a08050] rounded-full"
                    style={{
                      width: `${Math.min(100, (m.revenue / (stats.totalRevenue || 1)) * 100)}%`,
                    }}
                  />
                </div>
                <span className="text-sm text-[#c9a96e] w-16 text-right">${m.revenue.toFixed(0)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[#888] text-center py-8">No data yet. Publish some tracks to see analytics!</p>
        )}
      </div>
    </div>
  );
}
