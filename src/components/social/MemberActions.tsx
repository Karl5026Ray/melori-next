"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MessageSquare, Ban, Loader2 } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";

interface MemberActionsProps {
  memberId: string;
  memberName?: string | null;
  initiallyBlocked?: boolean;
  variant?: "row" | "menu";
}

// Actions shown for another member: start a DM (Superfan+) or block/unblock.
// Hidden entirely when the member is the signed-in user or nobody is signed in.
export function MemberActions({
  memberId,
  memberName,
  initiallyBlocked = false,
  variant = "row",
}: MemberActionsProps) {
  const { user } = useAuth();
  const router = useRouter();
  const [blocked, setBlocked] = useState<boolean>(initiallyBlocked);
  const [busy, setBusy] = useState<"dm" | "block" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!user || !memberId || user.id === memberId) return null;

  const who = memberName ?? "this member";

  const startDm = async () => {
    setBusy("dm");
    setError(null);
    try {
      const res = await authFetch("/api/social/conversations/start", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient_id: memberId }),
      });
      const body = await res.json().catch(() => ({}) as any);
      if (!res.ok) {
        if (res.status === 403) {
          setError(body?.error ?? "Messaging is unavailable between you two.");
        } else if (res.status === 401) {
          setError("Please sign in to send a message.");
        } else {
          setError(body?.error ?? "Could not start conversation.");
        }
        setBusy(null);
        return;
      }
      const conversationId = body?.conversation_id;
      if (!conversationId) {
        setError("Could not start conversation.");
        setBusy(null);
        return;
      }
      router.push(`/social/messages/${conversationId}`);
    } catch (err: any) {
      setError(err?.message ?? "Could not start conversation.");
      setBusy(null);
    }
  };

  const toggleBlock = async () => {
    const next = !blocked;
    if (next && !window.confirm(`Block ${who}? They won't be able to message you.`)) {
      return;
    }
    setBusy("block");
    setError(null);
    try {
      const res = await authFetch("/api/social/block", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocked_id: memberId, unblock: !next }),
      });
      const body = await res.json().catch(() => ({}) as any);
      if (!res.ok) {
        setError(body?.error ?? "Could not update block status.");
        setBusy(null);
        return;
      }
      setBlocked(Boolean(body?.blocked));
      setBusy(null);
    } catch (err: any) {
      setError(err?.message ?? "Could not update block status.");
      setBusy(null);
    }
  };

  const btnBase =
    "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition disabled:opacity-50";

  return (
    <div className={variant === "menu" ? "flex flex-col gap-2" : "flex items-center gap-2"}>
      {!blocked && (
        <button
          type="button"
          onClick={startDm}
          disabled={busy !== null}
          className={`${btnBase} bg-melori-accent/15 text-melori-accent hover:bg-melori-accent/25`}
          aria-label={`Message ${who}`}
        >
          {busy === "dm" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <MessageSquare className="h-4 w-4" />
          )}
          <span>Message</span>
        </button>
      )}
      <button
        type="button"
        onClick={toggleBlock}
        disabled={busy !== null}
        className={`${btnBase} ${
          blocked
            ? "bg-melori-accent/15 text-melori-accent hover:bg-melori-accent/25"
            : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
        }`}
        aria-label={blocked ? `Unblock ${who}` : `Block ${who}`}
      >
        {busy === "block" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Ban className="h-4 w-4" />
        )}
        <span>{blocked ? "Unblock" : "Block"}</span>
      </button>
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}
