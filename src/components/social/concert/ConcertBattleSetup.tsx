"use client";

import { useCallback, useEffect, useState } from "react";
import { Clock3, UserRoundPlus, X } from "lucide-react";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";
import { canConcertBattlePerform } from "@/lib/concertBattle";
import { BattleOpponentPicker } from "./BattleOpponentPicker";
import { ConcertLiveStage } from "./ConcertLiveStage";

type Person = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_url: string | null;
  verified: boolean | null;
};

type BattleState = {
  space: { id: string; title: string; topic: string | null; status: string };
  battle: {
    space_id: string;
    initiator_id: string;
    opponent_id: string | null;
    status: "selecting_opponent" | "invited" | "ready" | "round_active" | "round_intermission" | "completed" | "cancelled" | "expired" | "forfeited";
    current_round: number;
    phase_ends_at: string | null;
    version: number;
  };
  initiator: Person;
  opponent: Person | null;
  viewer_slot: 1 | 2 | null;
  viewer_capabilities: { can_select_opponent: boolean; can_cancel_invite: boolean };
  pending_invite: {
    id: string;
    recipient_id: string;
    expires_at: string;
    recipient: Person | null;
  } | null;
  scores?: {
    initiator_coins: number;
    opponent_coins: number;
  } | null;
  server_now: string;
};

function PersonTile({
  slot,
  person,
  state,
}: {
  slot: 1 | 2;
  person: Person | null;
  state: "initiator" | "selecting" | "pending" | "accepted";
}) {
  const name = person?.display_name || person?.username || (slot === 1 ? "Initiator" : "Opponent");
  return (
    <div className="min-h-44 rounded-2xl border border-melori-border bg-melori-elevated/50 p-5">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-melori-muted">
        Performer {slot}
      </p>
      <div className="mt-5 flex items-center gap-3">
        {person ? (
          <img src={person.avatar_url || "/favicon.png"} alt="" className="h-12 w-12 rounded-full object-cover" />
        ) : (
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-melori-void text-melori-teal">
            <UserRoundPlus className="h-5 w-5" />
          </div>
        )}
        <div className="min-w-0">
          <p className="truncate font-semibold">{name}</p>
          <p className="mt-1 text-xs text-melori-muted">
            {state === "initiator"
              ? "Initiator · fixed slot"
              : state === "selecting"
                ? "Choose one eligible member below"
                : state === "pending"
                  ? "Invitation sent · awaiting response"
                  : "Opponent confirmed · fixed slot"}
          </p>
        </div>
      </div>
    </div>
  );
}

export function ConcertBattleSetup({ spaceId }: { spaceId: string }) {
  const { user, isLoading: authLoading } = useAuth();
  const [view, setView] = useState<BattleState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [isCancelling, setIsCancelling] = useState(false);

  const refresh = useCallback(async () => {
    if (!user) return;
    setError("");
    try {
      const response = await authFetch(`/api/concert/battles/${spaceId}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load this Concert.");
      setView(data);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load this Concert.");
    } finally {
      setIsLoading(false);
    }
  }, [spaceId, user]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setIsLoading(false);
      return;
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 25_000);
    return () => window.clearInterval(interval);
  }, [authLoading, refresh, user]);

  async function cancelPendingInvite() {
    setIsCancelling(true);
    setError("");
    try {
      const response = await authFetch(`/api/concert/battles/${spaceId}/invite`, {
        method: "DELETE",
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not cancel this invitation.");
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not cancel this invitation.");
    } finally {
      setIsCancelling(false);
    }
  }

  if (authLoading || isLoading) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <p className="text-sm text-melori-muted">Loading Concert battle…</p>
      </main>
    );
  }
  if (!user) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <section className="max-w-md rounded-2xl border border-melori-border bg-melori-elevated/40 p-6 text-center">
          <h1 className="text-xl font-bold">Sign in to view this Concert</h1>
          <p className="mt-2 text-sm text-melori-muted">
            Concert details and invitations are available only to signed-in members.
          </p>
        </section>
      </main>
    );
  }
  if (!view) {
    return (
      <main className="flex flex-1 items-center justify-center p-6">
        <section className="max-w-md rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-center">
          <h1 className="text-xl font-bold">Concert unavailable</h1>
          <p role="alert" className="mt-2 text-sm text-red-300">
            {error || "This Concert battle could not be loaded."}
          </p>
        </section>
      </main>
    );
  }

  const pendingPerson = view.pending_invite?.recipient ?? null;
  // Once the battle is performable the live stage IS the page. The setup tiles
  // and topic prose are dropped so the two video feeds keep the vertical budget
  // on a phone rather than sitting below a screen of pre-show chrome.
  const isPerforming = canConcertBattlePerform(view.battle.status);
  const slotTwoState = view.opponent
    ? "accepted"
    : view.battle.status === "invited"
      ? "pending"
      : "selecting";

  return (
    <main className="flex-1 overflow-y-auto p-4 pb-24 md:p-8">
      <div className="mx-auto max-w-4xl">
        <header className={isPerforming ? "mb-3" : "mb-6"}>
          {isPerforming ? null : (
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-melori-teal">
              Concert Battle
            </p>
          )}
          <h1 className={`mt-1 font-bold ${isPerforming ? "text-xl" : "text-2xl md:text-3xl"}`}>
            {view.space.title}
          </h1>
          {view.space.topic && !isPerforming ? (
            <p className="mt-2 text-sm text-melori-muted">{view.space.topic}</p>
          ) : null}
        </header>

        {isPerforming ? null : (
          <div className="grid gap-4 md:grid-cols-2">
            <PersonTile slot={1} person={view.initiator} state="initiator" />
            <PersonTile
              slot={2}
              person={view.opponent ?? pendingPerson}
              state={slotTwoState}
            />
          </div>
        )}

        <div className={isPerforming ? "" : "mt-5"} aria-live="polite">
          {error ? <p role="alert" className="mb-4 rounded-xl bg-red-500/10 p-3 text-sm text-red-400">{error}</p> : null}
          {view.battle.status === "selecting_opponent" && view.viewer_capabilities.can_select_opponent ? (
            <BattleOpponentPicker spaceId={spaceId} onInviteSent={() => void refresh()} />
          ) : null}
          {view.battle.status === "selecting_opponent" && !view.viewer_capabilities.can_select_opponent ? (
            <section className="rounded-2xl border border-melori-border bg-melori-elevated/40 p-5 text-sm text-melori-muted">
              The initiator is choosing an opponent. Audience members cannot occupy a performer slot.
            </section>
          ) : null}
          {view.battle.status === "invited" ? (
            <section className="rounded-2xl border border-teal-500/30 bg-teal-500/10 p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="flex items-center gap-2 font-semibold">
                    <Clock3 className="h-4 w-4 text-melori-teal" />
                    Invitation sent
                  </p>
                  <p className="mt-2 text-sm text-melori-muted">
                    {pendingPerson?.display_name || pendingPerson?.username || "Your selected member"} can accept
                    until {view.pending_invite ? new Date(view.pending_invite.expires_at).toLocaleString() : "the invitation expires"}.
                  </p>
                </div>
                {view.viewer_capabilities.can_cancel_invite ? (
                  <button
                    type="button"
                    onClick={() => void cancelPendingInvite()}
                    disabled={isCancelling}
                    className="inline-flex items-center gap-2 rounded-lg border border-melori-border px-3 py-2 text-sm font-semibold disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                    {isCancelling ? "Cancelling…" : "Cancel invitation"}
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}
          {/* Once both performer identities are fixed the setup screen hands
              over to the live battle stage. The stage is mounted only for a
              performable status, so a cancelled or completed battle can never
              open a camera. */}
          {canConcertBattlePerform(view.battle.status) ? (
            <section>
              {/* No "slots are fixed" banner here: the stage itself shows both
                  competitors, and on a phone that line costs the video row
                  height it cannot spare. */}
              <ConcertLiveStage
                view={{
                  space: { id: view.space.id, status: view.space.status },
                  battle: {
                    space_id: view.battle.space_id ?? view.space.id,
                    initiator_id: view.battle.initiator_id,
                    opponent_id: view.battle.opponent_id,
                    status: view.battle.status,
                    current_round: view.battle.current_round ?? 1,
                    regulation_rounds: 3,
                    phase_ends_at: view.battle.phase_ends_at ?? null,
                  },
                  initiator: view.initiator,
                  opponent: view.opponent,
                  viewer_slot: view.viewer_slot,
                  scores: view.scores ?? null,
                }}
                // Round transitions are server-side. When the stage reports one,
                // re-read the battle rather than mutating a local copy.
                onBattleChanged={() => void refresh()}
              />
            </section>
          ) : null}
          {["cancelled", "expired", "forfeited", "completed"].includes(view.battle.status) ? (
            <section className="rounded-2xl border border-melori-border bg-melori-elevated/40 p-5 text-sm text-melori-muted">
              This Concert is no longer accepting opponent invitations.
            </section>
          ) : null}
        </div>
      </div>
    </main>
  );
}
