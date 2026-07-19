"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, Loader2 } from "lucide-react";

interface DownloadItem {
  title: string;
  url: string;
}

// After Stripe returns here, poll /api/music/download for signed download
// links. The webhook records the purchase row asynchronously, so a 402 just
// means "not confirmed yet" — we retry a few times before offering a manual
// retry. Album purchases return one link per track.
export default function MusicDownload({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<
    "loading" | "ready" | "pending" | "error"
  >("loading");
  const [item, setItem] = useState<string>("");
  const [downloads, setDownloads] = useState<DownloadItem[]>([]);
  const [attempt, setAttempt] = useState(0);

  const fetchDownloads = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(
        `/api/music/download?session_id=${encodeURIComponent(sessionId)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setItem((data.item as string) ?? "");
        setDownloads((data.downloads as DownloadItem[]) ?? []);
        setStatus("ready");
        return;
      }
      if (res.status === 402) {
        setStatus("pending");
        return;
      }
      setStatus("error");
    } catch {
      setStatus("error");
    }
  }, [sessionId]);

  useEffect(() => {
    fetchDownloads();
  }, [fetchDownloads]);

  useEffect(() => {
    if (status !== "pending" || attempt >= 6) return;
    const t = setTimeout(() => {
      setAttempt((a) => a + 1);
      fetchDownloads();
    }, 2000);
    return () => clearTimeout(t);
  }, [status, attempt, fetchDownloads]);

  return (
    <>
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
        <CheckCircle2 className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-xl font-bold">Payment successful</h1>
      <p className="mt-2 text-sm text-text-secondary">
        Thanks for supporting the artist{item ? ` — ${item}` : ""}. Your
        download{downloads.length > 1 ? "s are" : " is"} ready below.
      </p>

      <div className="mt-6 space-y-3">
        {(status === "loading" || status === "pending") && (
          <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" />
            {status === "pending" ? "Confirming payment…" : "Preparing your download…"}
          </span>
        )}

        {status === "ready" &&
          downloads.map((d, i) => (
            <a
              key={i}
              href={d.url}
              className="flex items-center justify-center gap-2 rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90"
            >
              <Download className="h-4 w-4" />
              {downloads.length > 1 ? d.title : "Download"}
            </a>
          ))}

        {status === "ready" && downloads.length === 0 && (
          <p className="text-sm text-text-secondary">
            Your purchase is confirmed. Download links will appear in your
            library shortly.
          </p>
        )}

        {status === "error" && (
          <div className="text-sm">
            <p className="text-red-500">
              We couldn&apos;t prepare your download automatically.
            </p>
            <button
              type="button"
              onClick={() => {
                setAttempt(0);
                fetchDownloads();
              }}
              className="mt-3 rounded-md border border-brand-border px-4 py-2 font-semibold"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      <Link
        href="/music"
        className="mt-8 inline-block text-sm text-text-secondary underline"
      >
        Back to music
      </Link>
    </>
  );
}
