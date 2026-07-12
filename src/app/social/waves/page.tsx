"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";
import {
  useCanParticipate,
  UpgradePrompt,
} from "@/components/social/UpgradePrompt";
import type { Wave } from "@/types/social";
import { Hand, Check, X, MessageCircle, Clock, Search } from "lucide-react";

type Tab = "incoming" | "outgoing";

type Member = {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: string | null;
  verified: boolean | null;
};

type SendState = "sending" | "sent" | "already";

export default function WavesPage() {
  const { user } = useAuth();
  const router = useRouter();
  const canParticipate = useCanParticipate();
  const [tab, setTab] = useState<Tab>("incoming");
  const [waves, setWaves] = useState<Wave[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // "Send a Wave" member picker.
  const [modalOpen, setModalOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [members, setMembers] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [sendStatus, setSendStatus] = useState<Record<string, SendState>>({});

  const fetchWaves = useCallback(async () => {
    setIsLoading(true);
    const res = await authFetch(`/api/social/waves?direction=${tab}`);
    if (res.ok) {
      const { waves } = await res.json();
      setWaves(waves ?? []);
    }
    setIsLoading(false);
  }, [tab]);

  useEffect(() => {
    if (user) fetchWaves();
  }, [user, tab, fetchWaves]);

  const respond = useCallback(
    async (id: string, action: "accept" | "decline") => {
      setBusyId(id);
      const res = await authFetch(`/api/social/waves/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      setBusyId(null);
      if (res.ok) {
        const body = await res.json().catch(() => ({}));
        if (action === "accept" && body?.conversation_id) {
          router.push(`/social/messages/${body.conversation_id}`);
          return;
        }
        fetchWaves();
      }
    },
    [fetchWaves, router],
  );

  const fetchMembers = useCallback(async (query: string) => {
    setMembersLoading(true);
    const res = await authFetch(
      `/api/social/members?q=${encodeURIComponent(query)}`,
    );
    if (res.ok) {
      const { members } = await res.json();
      setMembers(members ?? []);
    } else {
      setMembers([]);
    }
    setMembersLoading(false);
  }, []);

  // Debounced member search while the picker is open (empty query → first 20).
  useEffect(() => {
    if (!modalOpen) return;
    const t = setTimeout(() => {
      void fetchMembers(memberQuery);
    }, 300);
    return () => clearTimeout(t);
  }, [modalOpen, memberQuery, fetchMembers]);

  const openPicker = useCallback(() => {
    setSendStatus({});
    setMemberQuery("");
    setModalOpen(true);
  }, []);

  // Closing the picker surfaces what they just sent in the outgoing tab, which
  // refetches via the existing effect keyed on `tab`.
  const closePicker = useCallback(() => {
    setModalOpen(false);
    setTab("outgoing");
  }, []);

  const sendWave = useCallback(async (m: Member) => {
    const name = m.display_name || m.username || "Member";
    const note = window.prompt(`Add a short note to your wave to ${name}?`, "");
    if (note === null) return;
    setSendStatus((prev) => ({ ...prev, [m.id]: "sending" }));
    const res = await authFetch("/api/social/waves", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recipient_id: m.id, message: note || undefined }),
    });
    if (res.ok) {
      setSendStatus((prev) => ({ ...prev, [m.id]: "sent" }));
      return;
    }
    if (res.status === 409) {
      setSendStatus((prev) => ({ ...prev, [m.id]: "already" }));
      return;
    }
    setSendStatus((prev) => {
      const next = { ...prev };
      delete next[m.id];
      return next;
    });
    if (res.status === 403) {
      alert("Waves are a Superfan feature");
      return;
    }
    const body = await res.json().catch(() => ({}));
    alert(body?.error || "Could not send wave. Please try again.");
  }, []);

  if (!user) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-melori-muted">Sign in to see your waves.</p>
      </div>
    );
  }

  if (!canParticipate) {
    return (
      <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 animate-fade-in">
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-xl bg-melori-purple/10 flex items-center justify-center">
              <Hand className="w-5 h-5 text-melori-purple" />
            </div>
            <div>
              <h2 className="text-2xl font-bold">Waves</h2>
              <p className="text-sm text-melori-muted">
                Private chat invites from other members.
              </p>
            </div>
          </div>
          <UpgradePrompt action="use Waves" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 animate-fade-in">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-10 h-10 rounded-xl bg-melori-purple/10 flex items-center justify-center shrink-0">
              <Hand className="w-5 h-5 text-melori-purple" />
            </div>
            <div className="min-w-0">
              <h2 className="text-2xl font-bold">Waves</h2>
              <p className="text-sm text-melori-muted truncate">
                Private chat invites. Accepting opens a DM.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openPicker}
            className="btn-primary rounded-full px-4 py-2 text-sm font-semibold flex items-center gap-2 shrink-0"
          >
            <Hand className="w-4 h-4" />
            Send a Wave
          </button>
        </div>

        <div className="mb-6 flex gap-1 rounded-full border border-melori-border bg-melori-elevated/40 p-1 w-fit">
          {(["incoming", "outgoing"] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-full text-sm font-medium capitalize transition ${
                tab === t
                  ? "bg-melori-purple text-white shadow"
                  : "text-melori-muted hover:text-melori-text"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-melori-purple border-t-transparent rounded-full animate-spin" />
          </div>
        ) : waves.length === 0 ? (
          <div className="text-center py-16 rounded-2xl border border-dashed border-melori-border">
            <Hand className="w-10 h-10 text-melori-muted mx-auto mb-3" />
            <p className="text-sm text-melori-muted">
              {tab === "incoming"
                ? "No incoming waves right now."
                : "You haven't sent any waves yet."}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {waves.map((w) => {
              const other = tab === "incoming" ? w.sender : w.recipient;
              const disabled = busyId === w.id || w.status !== "pending";
              return (
                <li
                  key={w.id}
                  className="rounded-2xl border border-melori-border bg-melori-elevated/40 p-4 flex items-start gap-4"
                >
                  <img
                    src={other?.avatar_url || "/favicon.png"}
                    className="w-11 h-11 rounded-full object-cover"
                    alt=""
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-sm truncate">
                        {other?.display_name || "Unknown"}
                      </p>
                      <StatusPill status={w.status} />
                    </div>
                    {w.message && (
                      <p className="text-sm text-melori-text whitespace-pre-wrap mb-2">
                        {w.message}
                      </p>
                    )}
                    <p className="text-xs text-melori-muted flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {relative(w.created_at)}
                    </p>
                  </div>
                  <div className="flex flex-col gap-2">
                    {tab === "incoming" && w.status === "pending" && (
                      <>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => respond(w.id, "accept")}
                          className="btn-primary px-3 py-1.5 rounded-full text-xs font-semibold flex items-center gap-1 disabled:opacity-50"
                        >
                          <Check className="w-3 h-3" />
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={disabled}
                          onClick={() => respond(w.id, "decline")}
                          className="px-3 py-1.5 rounded-full text-xs font-medium border border-melori-border text-melori-muted hover:bg-melori-elevated transition flex items-center gap-1 disabled:opacity-50"
                        >
                          <X className="w-3 h-3" />
                          Decline
                        </button>
                      </>
                    )}
                    {w.status === "accepted" && w.conversation_id && (
                      <Link
                        href={`/social/messages/${w.conversation_id}`}
                        className="px-3 py-1.5 rounded-full text-xs font-semibold border border-melori-purple/40 text-melori-purple hover:bg-melori-purple/10 transition flex items-center gap-1"
                      >
                        <MessageCircle className="w-3 h-3" />
                        Open chat
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {modalOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm sm:p-4"
          onClick={closePicker}
        >
          <div
            className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl bg-melori-elevated border border-melori-border p-5 max-h-[92vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold">Send a Wave</h3>
              <button
                type="button"
                onClick={closePicker}
                aria-label="Close"
                className="p-2 rounded-lg hover:bg-white/5 transition"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-melori-muted" />
              <input
                type="text"
                value={memberQuery}
                onChange={(e) => setMemberQuery(e.target.value)}
                placeholder="Search members by name…"
                className="w-full bg-melori-void/60 border border-melori-border rounded-xl pl-9 pr-4 py-2.5 text-sm focus:outline-none focus:border-melori-purple transition"
              />
            </div>

            {membersLoading ? (
              <div className="flex justify-center py-12">
                <div className="w-8 h-8 border-2 border-melori-purple border-t-transparent rounded-full animate-spin" />
              </div>
            ) : members.length === 0 ? (
              <p className="text-center text-sm text-melori-muted py-12">
                No members found.
              </p>
            ) : (
              <ul className="space-y-2 overflow-y-auto max-h-[64vh] -mr-1 pr-1">
                {members.map((m) => {
                  const name = m.display_name || m.username || "Member";
                  const status = sendStatus[m.id];
                  return (
                    <li
                      key={m.id}
                      className="flex items-center gap-3 rounded-xl border border-melori-border bg-melori-void/40 p-2.5"
                    >
                      <img
                        src={m.avatar_url || "/favicon.png"}
                        className="w-10 h-10 rounded-full object-cover shrink-0"
                        alt=""
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1">
                          <p className="font-semibold text-sm truncate">
                            {name}
                          </p>
                          {m.verified && (
                            <Check className="w-3.5 h-3.5 text-melori-purple shrink-0" />
                          )}
                        </div>
                      </div>
                      {status === "sent" ? (
                        <span className="text-xs font-semibold text-melori-success flex items-center gap-1 shrink-0">
                          <Check className="w-3.5 h-3.5" />
                          Wave sent
                        </span>
                      ) : status === "already" ? (
                        <span className="text-xs font-medium text-melori-muted shrink-0">
                          Already sent
                        </span>
                      ) : (
                        <button
                          type="button"
                          disabled={status === "sending"}
                          onClick={() => sendWave(m)}
                          className="btn-primary rounded-full px-3 py-1.5 text-xs font-semibold flex items-center gap-1 shrink-0 disabled:opacity-50"
                        >
                          <Hand className="w-3.5 h-3.5" />
                          Wave
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: Wave["status"] }) {
  const map: Record<
    Wave["status"],
    { label: string; className: string }
  > = {
    pending: {
      label: "Pending",
      className: "bg-yellow-500/10 text-yellow-300 border-yellow-500/30",
    },
    accepted: {
      label: "Accepted",
      className:
        "bg-melori-success/10 text-melori-success border-melori-success/30",
    },
    declined: {
      label: "Declined",
      className: "bg-red-500/10 text-red-300 border-red-500/30",
    },
    expired: {
      label: "Expired",
      className: "bg-melori-elevated text-melori-muted border-melori-border",
    },
  };
  const v = map[status];
  return (
    <span
      className={`text-[10px] uppercase tracking-wide font-semibold border px-1.5 py-0.5 rounded-full ${v.className}`}
    >
      {v.label}
    </span>
  );
}

function relative(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const min = Math.floor(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
