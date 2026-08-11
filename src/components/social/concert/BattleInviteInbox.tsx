"use client";

import { useCallback, useEffect, useState } from "react";
import { BellRing, Check, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/social/providers/AuthProvider";
import { authFetch } from "@/lib/authClient";

type Invite = {
  id: string;
  space_id: string;
  expires_at: string;
  sender: { display_name: string | null; username: string | null; avatar_url: string | null } | null;
  space: { title: string; topic: string | null } | null;
};

// Mounted once in the social layout. The battle tables intentionally have no
// client read policies, so this uses authenticated polling instead of a direct
// Realtime subscription that could expose another recipient's invite.
export function BattleInviteInbox() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [error, setError] = useState("");
  const [actingId, setActingId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!user) return;
    try {
      const response = await authFetch("/api/concert/battle-invites");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not load Concert invitations.");
      setInvites(data.invites ?? []);
      setError("");
    } catch (reason) {
      // Keep any already-rendered invite visible rather than losing an incoming
      // alert during a transient network failure.
      setError(reason instanceof Error ? reason.message : "Could not load Concert invitations.");
    }
  }, [user]);

  useEffect(() => {
    if (authLoading || !user) {
      setInvites([]);
      return;
    }
    void refresh();
    const interval = window.setInterval(() => void refresh(), 25_000);
    return () => window.clearInterval(interval);
  }, [authLoading, refresh, user]);

  async function respond(invite: Invite, action: "accept" | "decline") {
    setActingId(invite.id);
    setError("");
    try {
      const response = await authFetch(`/api/concert/battle-invites/${invite.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Could not update invitation.");
      setInvites((current) => current.filter((item) => item.id !== invite.id));
      if (action === "accept") router.push(data.href ?? `/social/concert/${data.space_id}`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not update invitation.");
    } finally {
      setActingId(null);
    }
  }

  if (!user || invites.length === 0) return null;
  const invite = invites[0];
  const senderName = invite.sender?.display_name || invite.sender?.username || "A Melori member";
  return (
    <aside
      className="fixed right-4 top-20 z-50 w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-teal-500/40 bg-melori-elevated p-4 shadow-2xl"
      aria-live="assertive"
      aria-label="Concert battle invitation"
    >
      <div className="flex gap-3">
        <div className="rounded-full bg-teal-500/15 p-2 text-melori-teal">
          <BellRing className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Concert invitation</p>
          <p className="mt-1 text-sm text-melori-muted">
            {senderName} invited you to battle in {invite.space?.title || "a Concert"}.
          </p>
          <p className="mt-1 text-xs text-melori-muted">
            Expires {new Date(invite.expires_at).toLocaleString()}
            {invites.length > 1 ? ` · ${invites.length - 1} more pending` : ""}
          </p>
          {error ? <p role="alert" className="mt-2 text-xs text-red-400">{error}</p> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => void respond(invite, "accept")}
              disabled={actingId !== null}
              className="inline-flex items-center gap-1.5 rounded-lg bg-melori-teal px-3 py-2 text-xs font-semibold text-melori-void disabled:opacity-50"
            >
              <Check className="h-4 w-4" />
              {actingId === invite.id ? "Working…" : "Accept"}
            </button>
            <button
              type="button"
              onClick={() => void respond(invite, "decline")}
              disabled={actingId !== null}
              className="inline-flex items-center gap-1.5 rounded-lg border border-melori-border px-3 py-2 text-xs font-semibold disabled:opacity-50"
            >
              <X className="h-4 w-4" />
              Decline
            </button>
          </div>
        </div>
      </div>
    </aside>
  );
}
