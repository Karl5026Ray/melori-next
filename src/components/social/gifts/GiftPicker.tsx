"use client";

import { useEffect, useMemo, useState } from "react";
import { Gift, LoaderCircle, Coins, X } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import {
  giftMediaKind,
  isEligibleGiftTarget,
  type GiftCatalogItem,
  type GiftSignal,
} from "@/lib/gifting";
import type { SpaceParticipant } from "@/types/social";

// Narrowed to just what this component reads, so callers outside MM Spaces
// (MM Faces' LiveRoom builds its roster from LiveKit tiles, not
// `space_participants` rows) can pass a target list without fabricating a
// full Profile. A real SpaceParticipant satisfies this structurally, so
// existing Concert callers are unaffected.
export type GiftTargetCandidate = Pick<SpaceParticipant, "user_id" | "role"> & {
  user?: { display_name?: string | null } | null;
};

type CoinPack = {
  id: string;
  name: string;
  coin_amount: number;
  bonus_label: string | null;
  price_usd_cents: number;
};

export function GiftPicker({
  spaceId,
  hostId,
  participants,
  senderName,
  roomLabel = "Concert",
  onSignal,
}: {
  spaceId: string;
  hostId: string;
  participants: GiftTargetCandidate[];
  senderName?: string;
  // Copy only — which room type this is doesn't change any behavior here,
  // the server enforces eligibility. Concert keeps its existing copy by
  // default; Faces Duo passes "Duo".
  roomLabel?: string;
  onSignal: (signal: GiftSignal) => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [gifts, setGifts] = useState<GiftCatalogItem[]>([]);
  const [packs, setPacks] = useState<CoinPack[]>([]);
  const [targetId, setTargetId] = useState("");
  const [showCoins, setShowCoins] = useState(false);
  const [error, setError] = useState("");

  const targets = useMemo(
    () => participants.filter((p) => isEligibleGiftTarget(p, hostId)),
    [participants, hostId],
  );

  useEffect(() => {
    if (!targets.some((p) => p.user_id === targetId)) {
      setTargetId(targets[0]?.user_id ?? "");
    }
  }, [targets, targetId]);

  // @google/model-viewer registers a browser-only custom element at import
  // time, so it must never load during SSR — pull it in lazily, client-side,
  // only once the catalog actually has a GLB gift to thumbnail.
  useEffect(() => {
    if (gifts.some((gift) => giftMediaKind(gift.asset_url) === "model")) {
      void import("@google/model-viewer");
    }
  }, [gifts]);

  async function openPicker() {
    setOpen(true);
    setError("");
    setLoading(true);
    try {
      const [catalogRes, walletRes] = await Promise.all([
        authFetch("/api/gifts"),
        authFetch("/api/gifts/wallet"),
      ]);
      if (!catalogRes.ok || !walletRes.ok) throw new Error("Could not load gifting");
      const catalog = await catalogRes.json();
      const wallet = await walletRes.json();
      setGifts(catalog.gifts ?? []);
      setPacks(catalog.packs ?? []);
      setBalance(wallet.balance ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load gifting");
    } finally {
      setLoading(false);
    }
  }

  async function sendGift(gift: GiftCatalogItem) {
    if (!targetId || sending) return;
    setSending(gift.id);
    setError("");
    try {
      const res = await authFetch("/api/gifts/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ space_id: spaceId, target_id: targetId, gift_id: gift.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Could not send gift");
      setBalance(data.balance);
      onSignal({
        type: "gift",
        giftSendId: data.gift_send_id,
        gift: data.gift ?? gift,
        targetId,
        senderName,
      });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send gift");
    } finally {
      setSending(null);
    }
  }

  async function checkout(packId: string) {
    setSending(`pack:${packId}`);
    setError("");
    try {
      const res = await authFetch("/api/gifts/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pack_id: packId, space_id: spaceId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.url) throw new Error(data.error ?? "Could not start checkout");
      window.location.assign(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout");
      setSending(null);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-amber-400 px-4 py-2 text-sm font-bold text-black shadow-lg transition hover:bg-amber-300"
        data-testid="gift-picker-open"
        aria-label={`Send a ${roomLabel} gift`}
      >
        <Gift className="h-4 w-4" aria-hidden />
        Gift
      </button>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end bg-black/65 p-0 sm:items-center sm:justify-center sm:p-6" role="dialog" aria-modal="true" aria-label={`Send a ${roomLabel} gift`}>
          <button className="absolute inset-0" aria-label="Close gifts" onClick={() => setOpen(false)} />
          <section className="relative max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl border border-white/10 bg-melori-elevated p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:rounded-3xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold">{roomLabel} gifts</h2>
                <p className="text-sm text-melori-muted">{balance === null ? "Loading balance…" : `${balance.toLocaleString()} coins`}</p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="grid min-h-11 min-w-11 place-items-center rounded-full hover:bg-white/10" aria-label="Close gifts"><X className="h-5 w-5" /></button>
            </div>
            {loading ? (
              <div className="grid min-h-40 place-items-center text-melori-muted"><LoaderCircle className="h-6 w-6 animate-spin" aria-label="Loading gifts" /></div>
            ) : (
              <>
                <label className="mb-4 block text-sm font-medium">
                  Send to
                  <select value={targetId} onChange={(e) => setTargetId(e.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-melori-border bg-black/20 px-3" data-testid="gift-target-select">
                    {targets.length ? targets.map((p) => <option key={p.user_id} value={p.user_id}>{p.user?.display_name ?? `${roomLabel} performer`}</option>) : <option value="">No active hosts or speakers</option>}
                  </select>
                </label>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="font-semibold">Choose a gift</h3>
                  <button type="button" onClick={() => setShowCoins((v) => !v)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-amber-300/40 px-3 text-sm text-amber-200 hover:bg-amber-300/10" data-testid="gift-coins-action"><Coins className="h-4 w-4" /> Coins</button>
                </div>
                {showCoins && <div className="mb-4 grid gap-2 sm:grid-cols-2">{packs.map((pack) => <button key={pack.id} type="button" onClick={() => checkout(pack.id)} disabled={!!sending} className="min-h-11 rounded-xl border border-melori-border p-3 text-left hover:border-amber-300 disabled:opacity-50" data-testid={`coin-pack-${pack.id}`}><b>{pack.name}</b><span className="block text-sm text-melori-muted">{pack.coin_amount.toLocaleString()} coins{pack.bonus_label ? ` · ${pack.bonus_label}` : ""} · ${(pack.price_usd_cents / 100).toFixed(2)}</span></button>)}</div>}
                {(["spark", "glow", "epic"] as const).map((tier) => {
                  const tierGifts = gifts.filter((g) => g.tier === tier);
                  if (!tierGifts.length) return null;
                  return <div key={tier} className="mb-4"><h4 className="mb-2 text-xs font-bold uppercase tracking-widest text-melori-muted">{tier}</h4><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{tierGifts.map((gift) => { const kind = giftMediaKind(gift.asset_url); return <button key={gift.id} type="button" disabled={!targetId || !!sending} onClick={() => sendGift(gift)} className="min-h-11 overflow-hidden rounded-xl border border-melori-border bg-black/20 text-left transition hover:border-amber-300 disabled:opacity-50" data-testid={`gift-send-${gift.id}`}><span className="flex h-24 items-center justify-center bg-black">{kind === "video" ? <video muted playsInline preload="metadata" src={gift.asset_url} className="h-full w-full object-contain" /> : kind === "model" ? <model-viewer src={gift.asset_url} alt="" auto-rotate camera-controls={false} disable-zoom interaction-prompt="none" loading="lazy" reveal="auto" className="h-full w-full" /> : <img src={gift.asset_url} alt="" className="h-full w-full object-contain" />}</span><span className="block p-2 text-sm font-semibold">{sending === gift.id ? "Sending…" : gift.name}<small className="block font-normal text-amber-200">{gift.price_coins} coins</small></span></button>; })}</div></div>;
                })}
                {!gifts.length && <p className="py-8 text-center text-sm text-melori-muted">No gifts are available right now.</p>}
              </>
            )}
            {error && <p role="alert" className="mt-3 rounded-xl bg-red-500/15 p-3 text-sm text-red-200">{error}</p>}
          </section>
        </div>
      )}
    </>
  );
}
