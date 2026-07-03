"use client";

import { useState, useEffect } from "react";
import { authFetch } from "@/lib/authClient";

interface ScheduledRelease {
  id: string;
  title: string;
  releaseDate: string;
  status: "draft" | "scheduled" | "published";
  type: "single" | "album";
}

export default function ReleaseScheduler() {
  const [releases, setReleases] = useState<ScheduledRelease[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());

  useEffect(() => {
    authFetch("/api/studio/schedule")
      .then((r) => r.json())
      .then((data) => {
        setReleases(data.releases || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const daysInMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1).getDay();

  const prevMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1));
  const nextMonth = () => setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1));

  const getReleasesForDay = (day: number) => {
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return releases.filter((r) => r.releaseDate === dateStr);
  };

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-10 h-10 border-3 border-[#c9a96e]/20 border-t-[#c9a96e] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#888]">Loading schedule...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Calendar Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">
          {monthNames[currentMonth.getMonth()]} {currentMonth.getFullYear()}
        </h2>
        <div className="flex gap-2">
          <button onClick={prevMonth} className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:border-[#c9a96e]/40 transition-all cursor-pointer">
            ←
          </button>
          <button onClick={nextMonth} className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg hover:border-[#c9a96e]/40 transition-all cursor-pointer">
            →
          </button>
        </div>
      </div>

      {/* Calendar Grid */}
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <div className="grid grid-cols-7 gap-1 mb-2">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
            <div key={d} className="text-center text-xs text-[#888] font-medium py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 gap-1">
          {Array.from({ length: firstDayOfMonth }).map((_, i) => (
            <div key={`empty-${i}`} className="aspect-square" />
          ))}
          {Array.from({ length: daysInMonth }).map((_, i) => {
            const day = i + 1;
            const dayReleases = getReleasesForDay(day);
            const isToday =
              new Date().getDate() === day &&
              new Date().getMonth() === currentMonth.getMonth() &&
              new Date().getFullYear() === currentMonth.getFullYear();

            return (
              <div
                key={day}
                className={`aspect-square border rounded-lg p-1 flex flex-col gap-0.5 transition-all
                  ${isToday ? "border-[#c9a96e]/50 bg-[#c9a96e]/5" : "border-white/5 hover:border-white/10"}
                `}
              >
                <span className={`text-xs font-medium ${isToday ? "text-[#c9a96e]" : "text-[#888]"}`}>
                  {day}
                </span>
                {dayReleases.map((r) => (
                  <div
                    key={r.id}
                    className={`text-[10px] px-1 py-0.5 rounded truncate
                      ${r.status === "scheduled" ? "bg-blue-500/20 text-blue-300" : "bg-green-500/20 text-green-300"}
                    `}
                  >
                    {r.title}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      {/* Upcoming Releases List */}
      <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="font-semibold mb-4">Upcoming Releases</h3>
        {releases.filter((r) => r.status === "scheduled").length === 0 ? (
          <p className="text-[#888] text-center py-8">No scheduled releases. Set a release date on your draft tracks!</p>
        ) : (
          <div className="space-y-3">
            {releases
              .filter((r) => r.status === "scheduled")
              .sort((a, b) => new Date(a.releaseDate).getTime() - new Date(b.releaseDate).getTime())
              .map((r) => (
                <div key={r.id} className="flex items-center gap-4 bg-white/5 rounded-xl p-4">
                  <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center text-lg">
                    📅
                  </div>
                  <div className="flex-1">
                    <p className="font-medium">{r.title}</p>
                    <p className="text-sm text-[#888]">{r.releaseDate} • {r.type}</p>
                  </div>
                  <span className="text-xs bg-blue-500/10 text-blue-400 px-2 py-1 rounded-full border border-blue-500/20">
                    Scheduled
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}
