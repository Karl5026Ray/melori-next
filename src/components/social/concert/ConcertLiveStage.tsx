"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";
import {
  joinVideoRoom,
  leaveVideoRoom,
  ensureVideoAudio,
  type RemoteVideo,
} from "@/lib/livekitVideoClient";
import { joinPresence, leavePresence, type SpaceSignal } from "@/lib/pubnubClient";
import { useRoomComments } from "@/components/social/rooms/useRoomComments";
import {
  applyConcertVoteTally,
  concertFloatOffset,
  concertNoteGlyph,
  concertSideForSlot,
  concertSideForTarget,
  pushConcertFloat,
  CONCERT_FLOAT_DURATION_MS,
  type ConcertFloatItem,
  type ConcertScoreState,
  type ConcertSide,
} from "@/lib/concertStage";
import {
  canConcertBattlePerform,
  type ConcertBattleStatus,
} from "@/lib/concertBattle";
import {
  formatConcertPhaseCountdown,
  formatConcertRoundLabel,
  isConcertPhaseExpired,
} from "@/lib/concertRounds";
import { ConcertBattleStatusBar } from "./ConcertBattleStatusBar";
import { ConcertVideoStage, type ConcertCompetitorView } from "./ConcertVideoStage";
import { ConcertVoteTray } from "./ConcertVoteTray";
import { ConcertGuestList, type ConcertGuest } from "./ConcertGuestList";
import { ConcertChatPanel } from "./ConcertChatPanel";

export interface ConcertStagePerson {
  display_name?: string | null;
  username?: string | null;
  avatar_url?: string | null;
  verified?: boolean | null;
}

/**
 * Only the slice of the battle read the live stage actually needs. Declared
 * here rather than reusing the setup screen's wider state so the stage cannot
 * quietly start depending on invitation or capability fields.
 */
export interface ConcertStageView {
  space: { id: string; status: string };
  battle: {
    space_id: string;
    initiator_id: string;
    opponent_id: string | null;
    status: ConcertBattleStatus;
    current_round: number;
    regulation_rounds?: number | null;
    phase_ends_at: string | null;
  };
  initiator: ConcertStagePerson | null;
  opponent: ConcertStagePerson | null;
  viewer_slot: 1 | 2 | null;
  /** Audience vote tally for the battle's current round. */
  scores?: {
    round: number;
    initiator_votes: number;
    opponent_votes: number;
  } | null;
  /** The performer the viewer voted for in the current round, if any. */
  viewer_vote?: string | null;
}

interface RosterRow {
  user_id: string;
  role: string;
  badge: string | null;
  joined_at: string | null;
  user?: ConcertStagePerson | null;
}

/**
 * The Concert battle stage: two competitor feeds, an audience-vote score bar,
 * a vote tray, the audience roster, and live chat.
 *
 * Authority boundaries this component deliberately respects:
 *  - Publish permission is decided SERVER-side in /api/livekit-token from the
 *    battle's two identities (see decideConcertPublish). Passing role here only
 *    requests a token; it cannot grant a camera.
 *  - Votes are counted on the server. The score bar starts from the battle
 *    read and is then replaced by the ABSOLUTE tallies the vote route
 *    broadcasts, so a viewer who joins mid-round sees the real count and a
 *    duplicated message cannot inflate it.
 */
export function ConcertLiveStage({
  view,
  onBattleChanged,
}: {
  view: ConcertStageView;
  /**
   * Ask the owner of the battle state to re-read it. Round transitions happen
   * server-side, so the stage never edits the battle it was handed — it reports
   * that the phase moved and re-reads the truth.
   */
  onBattleChanged?: () => void;
}) {
  const { user } = useAuth();
  const battle = view.battle;
  const spaceId = battle.space_id;
  const viewerSlot = view.viewer_slot ?? null;
  const isCompetitor = viewerSlot === 1 || viewerSlot === 2;

  const viewScoreRound = view.scores?.round ?? battle.current_round ?? 0;
  const viewLeft = view.scores?.initiator_votes ?? 0;
  const viewRight = view.scores?.opponent_votes ?? 0;
  const [scores, setScores] = useState<ConcertScoreState>({
    round: viewScoreRound,
    left: viewLeft,
    right: viewRight,
  });
  const [floats, setFloats] = useState<readonly ConcertFloatItem[]>([]);
  const [roster, setRoster] = useState<readonly RosterRow[]>([]);
  const [liveIdentities, setLiveIdentities] = useState<readonly string[]>([]);
  const [votedFor, setVotedFor] = useState<string | null>(view.viewer_vote ?? null);
  const [pendingVote, setPendingVote] = useState<ConcertSide | null>(null);
  const [voteError, setVoteError] = useState<string | null>(null);
  const [localVideo, setLocalVideo] = useState<HTMLVideoElement | null>(null);
  const [mirrorLocal, setMirrorLocal] = useState(true);
  const [remoteVideos, setRemoteVideos] = useState<Record<string, HTMLVideoElement>>({});
  const [timerLabel, setTimerLabel] = useState(() =>
    formatConcertPhaseCountdown(battle, Date.now()),
  );
  const [roundBusy, setRoundBusy] = useState(false);
  const [roundError, setRoundError] = useState<string | null>(null);
  const [heat, setHeat] = useState(0);

  const floatSeq = useRef(0);
  const identities = useMemo(
    () => ({ initiatorId: battle.initiator_id, opponentId: battle.opponent_id }),
    [battle.initiator_id, battle.opponent_id],
  );

  const performable = canConcertBattlePerform(battle.status);

  // The chat channel is owned HERE (a single useRoomComments per room) and the
  // stream is handed down to the panel — see the note on useRoomComments.
  const { comments, sendComment, sending, error: chatError } = useRoomComments(
    spaceId,
    true,
  );

  const addFloat = useCallback((side: ConcertSide, glyph: string) => {
    const seq = (floatSeq.current += 1);
    const item: ConcertFloatItem = {
      id: `${side}-${seq}-${Date.now()}`,
      side,
      glyph,
      offsetPercent: concertFloatOffset(seq),
    };
    setFloats((prev) => pushConcertFloat(prev, item));
    window.setTimeout(() => {
      setFloats((prev) => prev.filter((entry) => entry.id !== item.id));
    }, CONCERT_FLOAT_DURATION_MS);
  }, []);

  // ---- re-sync from the battle read ---------------------------------------
  // A fresh battle read (round change, reconnect) is authoritative for the
  // round on screen. Broadcast tallies only ever move the CURRENT round, so a
  // new round resets the bar and the viewer's vote to what the server says.
  useEffect(() => {
    setScores({ round: viewScoreRound, left: viewLeft, right: viewRight });
  }, [viewScoreRound, viewLeft, viewRight]);
  useEffect(() => {
    setVotedFor(view.viewer_vote ?? null);
    setVoteError(null);
  }, [view.viewer_vote, viewScoreRound]);

  // ---- audience roster ---------------------------------------------------
  const loadRoster = useCallback(async () => {
    const res = await authFetch(`/api/social/spaces/${spaceId}/participants`, {
      cache: "no-store",
    }).catch(() => null);
    if (!res?.ok) return;
    const data = await res.json().catch(() => ({}));
    setRoster(Array.isArray(data.participants) ? data.participants : []);
  }, [spaceId]);

  useEffect(() => {
    void loadRoster();
    const timer = window.setInterval(() => void loadRoster(), 20_000);
    return () => window.clearInterval(timer);
  }, [loadRoster]);

  // ---- countdown ---------------------------------------------------------
  useEffect(() => {
    const tick = () => setTimerLabel(formatConcertPhaseCountdown(battle, Date.now()));
    tick();
    const timer = window.setInterval(tick, 1_000);
    return () => window.clearInterval(timer);
  }, [battle]);

  // ---- round transitions -------------------------------------------------
  // The server owns every transition (see /api/concert/battles/:id/rounds and
  // the once-a-minute cron backstop). This only asks, and only for the phase it
  // can currently see — `attemptedPhase` makes that at-most-once per phase, so a
  // stuck deadline cannot turn into a request loop.
  const attemptedPhase = useRef<string | null>(null);

  const callRounds = useCallback(
    async (action: "start" | "advance") => {
      setRoundError(null);
      setRoundBusy(true);
      try {
        const res = await authFetch(`/api/concert/battles/${spaceId}/rounds`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error ?? "Could not update the round.");
        }
        onBattleChanged?.();
      } catch (reason) {
        setRoundError(
          reason instanceof Error ? reason.message : "Could not update the round.",
        );
      } finally {
        setRoundBusy(false);
      }
    },
    [onBattleChanged, spaceId],
  );

  useEffect(() => {
    // Only a competitor asks. An audience of hundreds must not all fire the
    // same transition request the instant a timer expires; the cron covers the
    // case where neither competitor is connected.
    if (!isCompetitor) return;
    const phaseKey = `${battle.status}:${battle.current_round}:${battle.phase_ends_at ?? ""}`;
    const check = () => {
      if (attemptedPhase.current === phaseKey) return;
      if (!isConcertPhaseExpired(battle, Date.now())) return;
      attemptedPhase.current = phaseKey;
      void callRounds("advance");
    };
    check();
    const timer = window.setInterval(check, 1_000);
    return () => window.clearInterval(timer);
  }, [battle, callRounds, isCompetitor]);

  // A viewer does not drive transitions, but must still SEE them. Re-read the
  // battle shortly after its deadline instead of waiting out the parent's slow
  // poll and watching a dead 00:00.
  useEffect(() => {
    if (isCompetitor || !onBattleChanged) return;
    if (!battle.phase_ends_at) return;
    const delay = Date.parse(battle.phase_ends_at) - Date.now() + 2_500;
    const timer = window.setTimeout(
      () => onBattleChanged(),
      Math.max(1_000, Math.min(delay, 120_000)),
    );
    return () => window.clearTimeout(timer);
  }, [battle.phase_ends_at, isCompetitor, onBattleChanged]);

  // ---- LiveKit ------------------------------------------------------------
  useEffect(() => {
    if (!performable) return;
    let disposed = false;
    // roomMode is intentionally LEFT UNDEFINED: a competitor should arrive with
    // camera and microphone already publishing. Cinema's mic-only start exists
    // because its seats are claimed after joining; a battle's two performers are
    // fixed before the stage opens.
    void joinVideoRoom({
      spaceId,
      role: isCompetitor ? "publisher" : "subscriber",
      tier: "artist",
      audioProfile: "performance",
      onLocalVideo: (element) => {
        if (!disposed) setLocalVideo(element);
      },
      onLocalVideoRemoved: () => {
        if (!disposed) setLocalVideo(null);
      },
      onFacingModeChange: (facing) => {
        if (!disposed) setMirrorLocal(facing !== "environment");
      },
      onRemoteVideo: (video: RemoteVideo) => {
        if (disposed) return;
        setRemoteVideos((prev) => ({ ...prev, [video.identity]: video.element }));
      },
      onRemoteVideoRemoved: (identity) => {
        if (disposed) return;
        setRemoteVideos((prev) => {
          const next = { ...prev };
          delete next[identity];
          return next;
        });
      },
      onRosterIdentitiesChange: (ids) => {
        if (!disposed) setLiveIdentities(ids);
      },
      onAudioPlaybackChanged: (canPlay) => {
        if (!canPlay) void ensureVideoAudio().catch(() => {});
      },
    }).catch(() => {
      /* the tiles fall back to their placeholder state */
    });
    return () => {
      disposed = true;
      void leaveVideoRoom();
    };
  }, [spaceId, performable, isCompetitor]);

  // ---- vote signals -------------------------------------------------------
  useEffect(() => {
    if (!user) return;
    let disposed = false;
    void joinPresence({
      spaceId,
      uuid: user.id,
      // Server-published transitions land here. A round ending is the one
      // event every person in the room must see at the same moment, so it
      // re-reads the battle immediately instead of waiting for a poll.
      onSystemSignal: (message: Record<string, unknown>) => {
        if (disposed) return;
        const event = typeof message.event === "string" ? message.event : "";
        if (event.startsWith("concert-")) onBattleChanged?.();
      },
      onSignal: (signal: SpaceSignal) => {
        if (disposed || signal.type !== "vote") return;
        setScores((prev) =>
          applyConcertVoteTally(prev, {
            round: Number(signal.round),
            initiatorVotes: Number(signal.initiator_votes),
            opponentVotes: Number(signal.opponent_votes),
          }),
        );
        const side = concertSideForTarget({ targetId: signal.target, ...identities });
        if (side) addFloat(side, concertNoteGlyph((floatSeq.current += 1)));
      },
    }).catch(() => {});
    return () => {
      disposed = true;
      void leavePresence();
    };
  }, [spaceId, user, identities, addFloat]);

  // ---- voting -------------------------------------------------------------
  const castVote = useCallback(
    async (side: ConcertSide) => {
      const performerId = side === "left" ? battle.initiator_id : battle.opponent_id;
      if (!performerId) return;
      setPendingVote(side);
      setVoteError(null);
      try {
        const res = await authFetch(`/api/concert/battles/${spaceId}/vote`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ performer_id: performerId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setVoteError(typeof data.error === "string" ? data.error : "Could not record your vote.");
          if (data.reason === "voting-closed") onBattleChanged?.();
          return;
        }
        setVotedFor(performerId);
        setScores((prev) =>
          applyConcertVoteTally(prev, {
            round: Number(data.round),
            initiatorVotes: Number(data.initiator_votes),
            opponentVotes: Number(data.opponent_votes),
          }),
        );
        addFloat(side, concertNoteGlyph((floatSeq.current += 1)));
        setHeat((prev) => prev + 1);
      } catch {
        setVoteError("Could not record your vote.");
      } finally {
        setPendingVote(null);
      }
    },
    [battle.initiator_id, battle.opponent_id, spaceId, addFloat, onBattleChanged],
  );

  // ---- derived views ------------------------------------------------------
  const initiatorIdentityLive =
    battle.initiator_id != null && liveIdentities.includes(battle.initiator_id);
  const opponentIdentityLive =
    battle.opponent_id != null && liveIdentities.includes(battle.opponent_id);

  const competitorView = (
    side: ConcertSide,
    userId: string | null,
    profile: ConcertStagePerson | null,
    identityLive: boolean,
  ): ConcertCompetitorView => {
    const isSelf = Boolean(userId && user?.id === userId);
    return {
      side,
      name: profile?.display_name || profile?.username || (side === "left" ? "Challenger" : "Opponent"),
      avatarUrl: profile?.avatar_url ?? null,
      verified: Boolean(profile?.verified),
      videoElement: isSelf ? localVideo : userId ? remoteVideos[userId] ?? null : null,
      mirrored: isSelf && mirrorLocal,
      isLive: isSelf ? Boolean(localVideo) : identityLive,
      placeholder: isSelf
        ? "Turning on your camera…"
        : userId
          ? "Waiting for their camera"
          : "Waiting for an opponent",
    };
  };

  const guests: ConcertGuest[] = useMemo(
    () =>
      roster
        .filter((row) => liveIdentities.length === 0 || liveIdentities.includes(row.user_id))
        .map((row) => ({
          userId: row.user_id,
          name: row.user?.display_name || row.user?.username || "Member",
          handle: row.user?.username || "member",
          avatarUrl: row.user?.avatar_url ?? null,
          badge: row.badge ?? null,
          isCompetitor:
            row.user_id === battle.initiator_id || row.user_id === battle.opponent_id,
          joinedAt: row.joined_at ?? null,
        })),
    [roster, liveIdentities, battle.initiator_id, battle.opponent_id],
  );

  const votedSide: ConcertSide | null = votedFor
    ? concertSideForTarget({ targetId: votedFor, ...identities })
    : null;

  const voteDisabledReason = !user
    ? "Sign in to vote."
    : isCompetitor
      ? "You are performing. The audience votes each round."
      : battle.status !== "round_active"
        ? "Voting opens when a round is live."
        : !battle.opponent_id
          ? "Waiting for an opponent."
          : voteError;

  // A slim control band, rendered ONLY when it has something to say. It stays
  // out of the layout during a live round because on a 664px viewport every row
  // that is always present is height taken from the two video feeds.
  const isHost = viewerSlot === 1;
  const showBand =
    battle.status === "ready" ||
    battle.status === "round_intermission" ||
    Boolean(roundError);
  const roundBand = showBand ? (
    <div
      className="flex shrink-0 items-center justify-between gap-2 border-b border-white/[0.06] bg-[#16161c] px-3 py-1.5"
      data-testid="concert-round-band"
      data-battle-status={battle.status}
    >
      <p className="min-w-0 truncate text-[11px] font-semibold text-white/70">
        {roundError ? (
          <span className="text-[#ff8fa3]" role="alert">
            {roundError}
          </span>
        ) : battle.status === "ready" ? (
          isHost
            ? "Both performers are set. Start when you're ready."
            : "Waiting for the host to start round 1."
        ) : (
          <>
            Next round in{" "}
            <span className="tabular-nums text-[#f5e56b]">{timerLabel}</span>
            {viewerSlot
              ? ` · you are on the ${concertSideForSlot(viewerSlot)} stage`
              : ""}
          </>
        )}
      </p>
      {battle.status === "ready" && isHost ? (
        <button
          type="button"
          onClick={() => void callRounds("start")}
          disabled={roundBusy}
          className="shrink-0 rounded-full bg-[#ff2d55] px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.08em] text-white disabled:opacity-50"
          data-testid="concert-start-round"
        >
          {roundBusy ? "Starting…" : "Start round 1"}
        </button>
      ) : null}
    </div>
  ) : null;

  return (
    <div
      className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-white/[0.06] bg-[#0e0e12]"
      // The stage is height-capped so the whole band stack — score, video,
      // tray, guests, chat — fits above the mobile tab bar on a 664px viewport
      // instead of pushing chat below the fold.
      style={{ height: "min(72dvh, 700px)" }}
      data-testid="concert-live-stage"
      onPointerDown={() => {
        if (!votedSide) return;
        addFloat(votedSide, concertNoteGlyph((floatSeq.current += 1)));
      }}
    >
      <ConcertBattleStatusBar
        leftScore={scores.left}
        rightScore={scores.right}
        timerLabel={timerLabel}
        isLive={battle.status === "round_active"}
        roundLabel={formatConcertRoundLabel({
          status: battle.status,
          current_round: battle.current_round ?? 0,
          regulation_rounds: battle.regulation_rounds ?? 3,
        })}
      />

      {roundBand}

      <ConcertVideoStage
        left={competitorView("left", battle.initiator_id, view.initiator, initiatorIdentityLive)}
        right={competitorView("right", battle.opponent_id, view.opponent, opponentIdentityLive)}
        floats={floats}
      />

      <ConcertVoteTray
        leftName={view.initiator?.display_name || view.initiator?.username || "Left"}
        rightName={view.opponent?.display_name || view.opponent?.username || "Right"}
        votedSide={votedSide}
        pendingSide={pendingVote}
        disabledReason={voteDisabledReason}
        onVote={(side) => void castVote(side)}
      />

      {/* The social row is a FIXED band, not flex-1. Both it and the video row
          growing meant they split the leftover height evenly and squeezed the
          video down to ~134px on a 664px viewport — the same failure MM Cinema
          hit. Pinning the panels lets the video row take the remainder. */}
      <div className="flex h-[110px] shrink-0 gap-1.5 bg-[#111116] px-2 pb-2">
        <ConcertGuestList guests={guests} now={Date.now()} />
        <ConcertChatPanel
          comments={comments}
          sending={sending}
          error={chatError}
          heatCount={heat}
          onSend={(body) => void sendComment(body)}
        />
      </div>
    </div>
  );
}
