"use client";

// SCAFFOLD / DRAFT hook introduced alongside the "Cinema Room" design concept.
// It centralizes the *local, unpersisted* UI state for the talk-mode switcher
// and the whisper sidebar so RoomScreen.tsx only needs a few lines to wire
// both in. This is intentionally NOT durable or real-time yet. Still needed
// before this is a real feature:
//   - persisting `talkMode` on the room (e.g. a column near room_format) and
//     broadcasting changes to every participant in the room
//   - a real private transport for whisper messages, scoped to
//     (roomId, participantA, participantB) -- right now these are optimistic,
//     local-only messages that vanish on refresh and are never actually seen
//     by the other participant
//   - muting the current user's mic in the main room while whispering, via
//     roomMediaPolicy.ts's shouldMuteForTalkModeOrWhisper()
//
// None of the above requires changing this hook's return shape, which is why
// RoomScreen.tsx can wire against it now without waiting on that work.

import { useCallback, useState } from "react";
import { CINEMA_TALK_MODES, type CinemaTalkMode } from "@/lib/cinemaTalkModes";
import type { WhisperMessage } from "@/components/social/cinema/CinemaWhisperSidebar";

export interface WhisperTarget {
    userId: string;
    displayName: string;
}

export function useCinemaTalkModeAndWhisper() {
    const [talkMode, setTalkMode] = useState<CinemaTalkMode>(
          CINEMA_TALK_MODES[0].value,
        );
    const [whisperTarget, setWhisperTarget] = useState<WhisperTarget | null>(
          null,
        );
    const [whisperMessages, setWhisperMessages] = useState<
          readonly WhisperMessage[]
        >([]);

  const sendWhisperMessage = useCallback(
        (body: string) => {
                const trimmed = body.trim();
                if (!whisperTarget || !trimmed) return;
                // TODO: send through a real private transport instead of only
          // appending locally -- see the note at the top of this file.
          setWhisperMessages((prev) => [
                    ...prev,
            {
                        id: `local-${Date.now()}`,
                        fromUserId: "me",
                        fromDisplayName: "You",
                        body: trimmed,
                        sentAt: new Date().toISOString(),
            },
                  ]);
        },
        [whisperTarget],
      );

  const closeWhisper = useCallback(() => {
        setWhisperTarget(null);
        setWhisperMessages([]);
  }, []);

  return {
        talkMode,
        setTalkMode,
        whisperTarget,
        setWhisperTarget,
        whisperMessages,
        sendWhisperMessage,
        closeWhisper,
  };
}
