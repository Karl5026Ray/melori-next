"use client";

import { useState } from "react";
import { Hand } from "lucide-react";
import { authFetch } from "@/lib/authClient";
import { useAuth } from "@/components/social/providers/AuthProvider";

interface WaveButtonProps {
  recipientId: string;
  recipientName?: string | null;
  size?: "sm" | "md";
  variant?: "chip" | "icon";
}

// Small button that lets Superfans send a wave (private-chat invite).
// Silently hides if you'd be waving at yourself or you're logged out.
export function WaveButton({
  recipientId,
  recipientName,
  size = "sm",
  variant = "chip",
}: WaveButtonProps) {
  const { user } = useAuth();
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "error" | "duplicate"
  >("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!user || !recipientId || user.id === recipientId) return null;

  const disabled = status === "sending" || status === "sent";

  const send = async () => {
    setStatus("sending");
    setErrorMsg(null);
    const message =
      typeof window !== "undefined"
        ? window.prompt(
            `Add a short note to your wave to ${recipientName ?? "them"}?`,
            "",
          )
        : "";
    // User cancelled the prompt — abort the wave.
    if (message === null) {
      setStatus("idle");
      return;
    }
    try {
      const res = await authFetch("/api/social/waves", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          recipient_id: recipientId,
          message: message || undefined,
        }),
      });
      if (res.ok) {
        setStatus("sent");
        return;
      }
      const body = await res.json().catch(() => ({}));
      if (res.status === 409) {
        setStatus("duplicate");
      } else if (res.status === 403) {
        setErrorMsg("Waves are a Superfan feature");
        setStatus("error");
      } else {
        setErrorMsg(body?.error ?? "Wave failed");
        setStatus("error");
      }
    } catch (err: any) {
      setErrorMsg(err?.message ?? "Wave failed");
      setStatus("error");
    }
  };

  const label =
    status === "sending"
      ? "Sending…"
      : status === "sent"
        ? "Wave sent"
        : status === "duplicate"
          ? "Already sent"
          : status === "error"
            ? errorMsg ?? "Retry"
            : "Wave";

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={send}
        disabled={disabled}
        title={label}
        className={`p-2 rounded-full transition ${
          status === "sent" || status === "duplicate"
            ? "text-melori-success"
            : "text-melori-muted hover:text-melori-purple hover:bg-melori-purple/10"
        }`}
      >
        <Hand className={size === "sm" ? "w-4 h-4" : "w-5 h-5"} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={send}
      disabled={disabled}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition ${
        status === "sent" || status === "duplicate"
          ? "border-melori-success/30 bg-melori-success/10 text-melori-success"
          : status === "error"
            ? "border-red-400/40 bg-red-500/10 text-red-300"
            : "border-melori-border text-melori-muted hover:border-melori-purple/40 hover:text-melori-purple hover:bg-melori-purple/10"
      }`}
    >
      <Hand className="w-3 h-3" />
      {label}
    </button>
  );
}
