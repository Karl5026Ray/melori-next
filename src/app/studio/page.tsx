"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import TrackUploader from "./components/TrackUploader";
import WaveformEditor from "./components/WaveformEditor";
import TrackList from "./components/TrackList";
import AnalyticsPanel from "./components/AnalyticsPanel";
import ReleaseScheduler from "./components/ReleaseScheduler";

type Tab = "upload" | "tracks" | "waveform" | "analytics" | "schedule";

export default function StudioPage() {
  const [activeTab, setActiveTab] = useState<Tab>("upload");
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);

  const handleEditWaveform = useCallback((trackId: string) => {
    setSelectedTrackId(trackId);
    setActiveTab("waveform");
  }, []);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: "upload", label: "Upload", icon: "📤" },
    { id: "tracks", label: "My Tracks", icon: "🎵" },
    { id: "waveform", label: "Preview Editor", icon: "✂️" },
    { id: "analytics", label: "Analytics", icon: "📊" },
    { id: "schedule", label: "Schedule", icon: "📅" },
  ];

  return (
    <main className="min-h-screen bg-gradient-to-br from-[#0a0a0a] via-[#1a1a2e] to-[#0a0a0a] text-white">
      <div className="border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold bg-gradient-to-r from-[#c9a96e] to-[#f0d99c] bg-clip-text text-transparent">
                Artist Studio
              </h1>
              <p className="text-[#888] text-sm mt-1">
                Upload, edit, and release your music — keep 70% of every sale.
              </p>
            </div>
            <Link
              href="/"
              className="text-sm text-[#888] hover:text-[#c9a96e] transition-colors"
            >
              ← Back to MELORI
            </Link>
          </div>
        </div>
      </div>

      <div className="border-b border-white/[0.06]">
        <div className="max-w-7xl mx-auto px-6">
          <nav className="flex gap-1 -mb-px">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-5 py-4 text-sm font-medium transition-all border-b-2 cursor-pointer flex items-center gap-2
                  ${
                    activeTab === tab.id
                      ? "border-[#c9a96e] text-[#c9a96e]"
                      : "border-transparent text-[#888] hover:text-white hover:border-white/10"
                  }`}
              >
                <span>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === "upload" && <TrackUploader />}
        {activeTab === "tracks" && (
          <TrackList onEditWaveform={handleEditWaveform} />
        )}
        {activeTab === "waveform" && (
          <WaveformEditor
            trackId={selectedTrackId}
            onBack={() => setActiveTab("tracks")}
          />
        )}
        {activeTab === "analytics" && <AnalyticsPanel />}
        {activeTab === "schedule" && <ReleaseScheduler />}
      </div>
    </main>
  );
}
