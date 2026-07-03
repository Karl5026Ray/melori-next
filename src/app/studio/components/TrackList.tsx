"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Track {
  id: string;
  title: string;
  artist: string;
  album: string | null;
  genre: string | null;
  status: "draft" | "scheduled" | "published" | "archived";
  preview_url: string | null;
  created_at: string;
  duration: number | null;
}

interface TrackListProps {
  onEditWaveform: (trackId: string) => void;
}

export default function TrackList({ onEditWaveform }: TrackListProps) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | Track["status"]>("all");

  useEffect(() => {
    fetch("/api/studio/tracks")
      .then((r) => r.json())
      .then((data) => {
        setTracks(data.tracks || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filteredTracks = filter === "all" ? tracks : tracks.filter((t) => t.status === filter);

  const statusColors: Record<string, string> = {
    draft: "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
    scheduled: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    published: "bg-green-500/10 text-green-400 border-green-500/20",
    archived: "bg-gray-500/10 text-gray-400 border-gray-500/20",
  };

  const statusLabels: Record<string, string> = {
    draft: "Draft",
    scheduled: "Scheduled",
    published: "Published",
    archived: "Archived",
  };

  if (loading) {
    return (
      <div className="text-center py-20">
        <div className="w-10 h-10 border-3 border-[#c9a96e]/20 border-t-[#c9a96e] rounded-full animate-spin mx-auto mb-4" />
        <p className="text-[#888]">Loading your tracks...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Filter Tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["all", "draft", "scheduled", "published", "archived"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer
              ${filter === s
                ? "bg-[#c9a96e]/15 text-[#c9a96e] border border-[#c9a96e]/30"
                : "bg-white/5 text-[#888] border border-white/10 hover:border-white/20"
              }`}
          >
            {s === "all" ? "All Tracks" : statusLabels[s]}
            {s !== "all" && (
              <span className="ml-2 text-xs opacity-60">
                {tracks.filter((t) => t.status === s).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Track Grid */}
      {filteredTracks.length === 0 ? (
        <div className="text-center py-20 bg-white/[0.02] border border-white/[0.08] rounded-2xl">
          <p className="text-4xl mb-3">🎵</p>
          <p className="text-[#888] text-lg">
            {filter === "all" ? "No tracks yet. Upload your first!" : `No ${filter} tracks.`}
          </p>
          {filter === "all" && (
            <Link
              href="/studio?tab=upload"
              className="inline-block mt-4 px-6 py-3 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl"
            >
              Upload Track
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4">
          {filteredTracks.map((track) => (
            <div
              key={track.id}
              className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-5 flex items-center gap-5 hover:border-[#c9a96e]/20 transition-all"
            >
              {/* Art placeholder */}
              <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-[#c9a96e]/20 to-[#a08050]/20 flex items-center justify-center text-2xl flex-shrink-0">
                🎵
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-3 mb-1">
                  <h3 className="font-semibold truncate">{track.title}</h3>
                  <span className={`text-xs px-2 py-0.5 rounded-full border ${statusColors[track.status]}`}>
                    {statusLabels[track.status]}
                  </span>
                </div>
                <p className="text-sm text-[#888]">
                  {track.artist}
                  {track.album && ` • ${track.album}`}
                  {track.genre && ` • ${track.genre}`}
                </p>
                <p className="text-xs text-[#666] mt-1">
                  {track.preview_url ? "✓ Preview ready" : "⚠ No preview"}
                  {track.duration && ` • ${Math.floor(track.duration / 60)}:${(track.duration % 60).toString().padStart(2, "0")}`}
                </p>
              </div>

              {/* Actions */}
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => onEditWaveform(track.id)}
                  className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:border-[#c9a96e]/40 transition-all"
                  title="Edit 30-second preview"
                >
                  ✂️ Preview
                </button>
                <Link
                  href={`/music/${track.id}`}
                  className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-sm font-medium hover:border-[#c9a96e]/40 transition-all"
                >
                  View
                </Link>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
