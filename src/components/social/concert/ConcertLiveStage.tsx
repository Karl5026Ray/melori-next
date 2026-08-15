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
  applyConcertGift,
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
import type { GiftCatalogItem } from "@/lib/gifting";
import { ConcertBattleStatusBar } from "./ConcertBattleStatusBar";
import { ConcertVideoStage, type ConcertCompetitorView } from "./ConcertVideoStage";
import {
  ConcertGiftTray,
  resolveConcertTray,
  type ConcertTrayGift,
} from "./ConcertGiftTray";
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
  scores?: {
    initiator_coins: number;
    opponent_coins: number;
  } | null;
}

interface RosterRow {
  user_id: string;
  role: string;
  badge: string | null;
  joined_at: string | null;
  user?: ConcertStagePerson | null;
}

/**
 * The Concert battle stage: two competitor feeds, a coin score bar, an
 * instrument gift tray, the audience roster, and live chat.
 *
 * Authority boundaries this component deliberately respects:
 *  - Publish permission is decided SERVER-side in /api/livekit-token from the
 *    battle's two identities (see decideConcertPublish). Passing role here only
 *    requests a token; it cannot grant a camera.
 *  - Gift prices come from the server catalog; the tray never sends a price.
 *  - The score bar starts from the server aggregate and is then advanced by
 *    gift signals, so a viewer who joins mid-battle sees the real total.
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

  const [scores, setScores] = useState<ConcertScoreState>({
    left: view.scores?.initiator_coins ?? 0,
    right: view.scores?.opponent_coins ?? 0,
  });
  const [floats, setFloats] = useState<readonly ConcertFloatItem[]>([]);
  const [catalog, setCatalog] = useState<readonly GiftCatalogItem[]>([]);
  const [walletCoins, setWalletCoins] = useState<number | null>(null);
  const [roster, setRoster] = useState<readonly RosterRow[]>([]);
  const [liveIdentities, setLiveIdentities] = useState<readonly string[]>([]);
  const [gifterCoins, setGifterCoins] = useState<Record<string, number>>({});
  const [target, setTarget] = useState<ConcertSide | null>(null);
  const [pendingSlug, setPendingSlug] = useState<string | null>(null);
  const [giftError, setGiftError] = useState<string | null>(null);
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

  // ---- catalog + wallet ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [catalogRes, walletRes] = await Promise.all([
        authFetch("/api/gifts", { cache: "no-store" }).catch(() => null),
        authFetch("/api/gifts/wallet", { cache: "no-store" }).catch(() => null),
      ]);
      if (cancelled) return;
      if (catalogRes?.ok) {
        const data = await catalogRes.json().catch(() => ({}));
        setCatalog(Array.isArray(data.gifts) ? data.gifts : []);
      }
      if (walletRes?.ok) {
        const data = await walletRes.json().catch(() => ({}));
        setWalletCoins(Number(data.balance ?? 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  // ---- gift signals -------------------------------------------------------
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
        if (disposed || signal.type !== "gift" || !signal.gift) return;
        const side = concertSideForTarget({ targetId: signal.target, ...identities });
        if (!side) return;
        setScores((prev) =>
          applyConcertGift(prev, { targetId: signal.target, coins: signal.gift!.price_coins }, identities),
        );
        addFloat(side, giftGlyph(signal.gift.slug));
        if (signal.uuid) {
          setGifterCoins((prev) => ({
            ...prev,
            [signal.uuid!]: (prev[signal.uuid!] ?? 0) + signal.gift!.price_coins,
          }));
        }
      },
    }).catch(() => {});
    return () => {
      disposed = true;
      void leavePresence();
    };
  }, [spaceId, user, identities, addFloat]);

  // ---- sending ------------------------------------------------------------
  const sendGift = useCallback(
    async (entry: ConcertTrayGift) => {
      const gift = entry.gift;
      const side = target;
      if (!gift || !side) return;
      const targetId = side === "left" ? battle.initiator_id : battle.opponent_id;
      if (!targetId) return;
      setPendingSlug(entry.instrument.slug);
      setGiftError(null);
      try {
        const res = await authFetch("/api/gifts/send", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ space_id: spaceId, target_id: targetId, gift_id: gift.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setGiftError(typeof data.error === "string" ? data.error : "Could not send that gift.");
          return;
        }
        // Optimistic local feedback. The broadcast signal is suppressed for the
        // local sender, so the score and float must be applied here.
        setScores((prev) =>
          applyConcertGift(prev, { targetId, coins: gift.price_coins }, identities),
        );
        addFloat(side, entry.instrument.emoji);
        if (typeof data.balance === "number") setWalletCoins(data.balance);
        else setWalletCoins((prev) => (prev === null ? prev : Math.max(0, prev - gift.price_coins)));
        void sendComment(entry.instrument.comment);
        setHeat((prev) => prev + 1);
      } finally {
        setPendingSlug(null);
      }
    },
    [target, battle.initiator_id, battle.opponent_id, spaceId, identities, addFloat, sendComment],
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
          name: row.user?.display_name || row.user?.username || "Superfan",
          handle: row.user?.username || "superfan",
          avatarUrl: row.user?.avatar_url ?? null,
          badge: row.badge ?? null,
          isCompetitor:
            row.user_id === battle.initiator_id || row.user_id === battle.opponent_id,
          joinedAt: row.joined_at ?? null,
          coinsGifted: gifterCoins[row.user_id] ?? 0,
        })),
    [roster, liveIdentities, battle.initiator_id, battle.opponent_id, gifterCoins],
  );

  const tray = useMemo(() => resolveConcertTray(catalog), [catalog]);

  const disabledReason = !user
    ? "Sign in to send instruments."
    : isCompetitor
      ? "Competitors cannot gift themselves."
      : view.space.status !== "live"
        ? "Gifting opens when the battle goes live."
        : catalog.length > 0 && tray.every((entry) => !entry.gift)
          ? "Instrument gifts are not available yet."
          : giftError;

  // Default the gift target to whichever side the viewer is not on.
  useEffect(() => {
    if (target || isCompetitor) return;
    if (battle.initiator_id) setTarget("left");
  }, [target, isCompetitor, battle.initiator_id]);

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
        if (!target) return;
        addFloat(target, concertNoteGlyph((floatSeq.current += 1)));
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

      <ConcertGiftTray
        tray={tray}
        target={isCompetitor ? null : target}
        walletCoins={walletCoins}
        pendingSlug={pendingSlug}
        disabledReason={disabledReason}
        showTargetPicker={!isCompetitor}
        onTargetChange={setTarget}
        onSend={(entry) => void sendGift(entry)}
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

/** Emoji for a broadcast gift, falling back to a generic note. */
function giftGlyph(slug: string): string {
  switch (slug) {
    case "battle_guitar":
      return "🎸";
    case "battle_piano":
      return "🎹";
    case "battle_drum":
      return "🥁";
    case "battle_violin":
      return "🎻";
    case "battle_saxophone":
      return "🎷";
    default:
      return "🎁";
  }
}
