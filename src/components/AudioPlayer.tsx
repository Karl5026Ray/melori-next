"use client";

// Persistent audio player bar — placeholder for Phase 1, Step 5.
// Full implementation (Supabase signed URLs, play/pause, next/prev,
// volume, progress, localStorage persistence, mobile) comes in Step 5.
export default function AudioPlayer() {
  return (
    <div className="fixed bottom-0 inset-x-0 z-50 h-16 border-t border-brand-border bg-brand-surface/95 backdrop-blur">
      <div className="max-w-6xl mx-auto h-full px-6 flex items-center justify-between text-sm text-text-secondary">
        <span>No track playing</span>
        <span className="text-xs">Player coming in Step 5</span>
      </div>
    </div>
  );
}
