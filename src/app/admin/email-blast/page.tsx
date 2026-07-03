"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

interface SendResult {
  sent: number;
  failed: number;
  total: number;
}

export default function EmailBlastPage() {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [count, setCount] = useState<number | null>(null);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [fromName, setFromName] = useState("MELORI MUSIC");
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<SendResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/session")
      .then((r) => r.json())
      .then((data) => {
        if (!data.authenticated) {
          router.push("/admin");
          return;
        }
        setReady(true);
        return fetch("/api/admin/email-blast")
          .then((r) => r.json())
          .then((d) => {
            if (typeof d.total === "number") setCount(d.total);
          });
      })
      .catch(() => router.push("/admin"));
  }, [router]);

  const handleSend = async () => {
    setSending(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/admin/email-blast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subject, body: message, fromName }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Send failed");
      } else {
        setResult(data);
      }
    } catch {
      setError("Send failed. Please try again.");
    } finally {
      setSending(false);
      setConfirming(false);
    }
  };

  if (!ready) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-10 h-10 border-3 border-[#c9a96e]/20 border-t-[#c9a96e] rounded-full animate-spin" />
      </div>
    );
  }

  const canSend = subject.trim() && message.trim() && !sending;

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="bg-[#0d0d0d] border-b border-white/[0.06] px-8 py-4 flex items-center justify-between">
        <h1 className="text-xl font-bold">Email Blast</h1>
        <Link
          href="/admin/dashboard"
          className="text-xs text-[#c9a96e] hover:underline"
        >
          ← Back to Dashboard
        </Link>
      </header>

      <div className="max-w-2xl mx-auto p-8 space-y-6">
        <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
          <p className="text-sm text-[#888]">
            Eligible recipients (opted in to email updates)
          </p>
          <p className="text-3xl font-bold text-[#c9a96e]">
            {count === null ? "…" : count}
          </p>
        </div>

        {result ? (
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6 space-y-2">
            <h3 className="font-semibold text-lg">Blast complete</h3>
            <p className="text-sm text-[#ccc]">
              Sent: <span className="text-green-400 font-medium">{result.sent}</span>
            </p>
            <p className="text-sm text-[#ccc]">
              Failed: <span className="text-red-400 font-medium">{result.failed}</span>
            </p>
            <p className="text-sm text-[#ccc]">
              Total: <span className="font-medium">{result.total}</span>
            </p>
            <button
              onClick={() => {
                setResult(null);
                setSubject("");
                setMessage("");
              }}
              className="mt-3 px-4 py-2 bg-white/5 text-[#ccc] rounded-lg text-sm font-medium hover:bg-white/10 transition-all cursor-pointer"
            >
              Send another
            </button>
          </div>
        ) : (
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6 space-y-4">
            {error && (
              <div className="bg-red-500/10 border border-red-500/30 text-red-300 rounded-lg px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <div>
              <label className="block text-sm text-[#888] mb-1">From name</label>
              <input
                type="text"
                value={fromName}
                onChange={(e) => setFromName(e.target.value)}
                className="w-full bg-[#0a0a0a] border border-white/[0.1] rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[#c9a96e]"
              />
            </div>

            <div>
              <label className="block text-sm text-[#888] mb-1">Subject</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Updates & specials from MELORI MUSIC"
                className="w-full bg-[#0a0a0a] border border-white/[0.1] rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[#c9a96e]"
              />
            </div>

            <div>
              <label className="block text-sm text-[#888] mb-1">Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={10}
                placeholder="Write your message. Line breaks are preserved."
                className="w-full bg-[#0a0a0a] border border-white/[0.1] rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-[#c9a96e] resize-y"
              />
            </div>

            {confirming ? (
              <div className="space-y-3">
                <p className="text-sm text-[#ccc]">
                  Send this blast to{" "}
                  <span className="text-[#c9a96e] font-medium">
                    {count ?? 0}
                  </span>{" "}
                  recipient{count === 1 ? "" : "s"}? This cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handleSend}
                    disabled={sending}
                    className="px-5 py-2 bg-[#c9a96e] text-[#0a0a0a] rounded-lg text-sm font-semibold hover:bg-[#d8bd88] transition-all cursor-pointer disabled:opacity-50"
                  >
                    {sending ? "Sending…" : "Yes, send blast"}
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    disabled={sending}
                    className="px-5 py-2 bg-white/5 text-[#ccc] rounded-lg text-sm font-medium hover:bg-white/10 transition-all cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setConfirming(true)}
                disabled={!canSend}
                className="px-5 py-2 bg-[#c9a96e] text-[#0a0a0a] rounded-lg text-sm font-semibold hover:bg-[#d8bd88] transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Send blast
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
