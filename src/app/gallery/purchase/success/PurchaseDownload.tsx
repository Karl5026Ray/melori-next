"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Download, Loader2 } from "lucide-react";

// After Stripe returns here, poll /api/gallery/download for the signed original.
// The webhook records the purchase row asynchronously, so a 402 just means
// "not confirmed yet" — we retry a few times before showing a manual retry.
export default function PurchaseDownload({ sessionId }: { sessionId: string }) {
  const [status, setStatus] = useState<"loading" | "ready" | "pending" | "error">(
    "loading",
  );
  const [url, setUrl] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const fetchDownload = useCallback(async () => {
    setStatus("loading");
    try {
      const res = await fetch(
        `/api/gallery/download?session_id=${encodeURIComponent(sessionId)}`,
      );
      if (res.ok) {
        const data = await res.json();
        setUrl(data.url as string);
        setFilename((data.filename as string) ?? null);
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

  // Initial fetch + automatic retry while the webhook is still landing.
  useEffect(() => {
    fetchDownload();
  }, [fetchDownload]);

  useEffect(() => {
    if (status !== "pending" || attempt >= 5) return;
    const t = setTimeout(() => {
      setAttempt((a) => a + 1);
      fetchDownload();
    }, 2000);
    return () => clearTimeout(t);
  }, [status, attempt, fetchDownload]);

  return (
    <>
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-muted text-brand-primary">
        <CheckCircle2 className="h-6 w-6" />
      </span>
      <h1 className="mt-4 text-xl font-bold">Payment successful</h1>
      <p className="mt-2 text-sm text-text-secondary">
        Thanks for your purchase! Your high-resolution download is ready below.
      </p>

      <div className="mt-6">
        {status === "loading" && (
          <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing your
            download…
          </span>
        )}

        {status === "pending" && (
          <span className="inline-flex items-center gap-2 text-sm text-text-secondary">
            <Loader2 className="h-4 w-4 animate-spin" /> Confirming payment…
          </span>
        )}

        {status === "ready" && url && (
          <a
            href={url}
            download={filename ?? undefined}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-primary px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark"
          >
            <Download className="h-4 w-4" />
            Download your photo
          </a>
        )}

        {status === "error" && (
          <div>
            <p className="text-sm text-brand-primary">
              We couldn&apos;t confirm your download just yet.
            </p>
            <button
              type="button"
              onClick={() => {
                setAttempt(0);
                fetchDownload();
              }}
              className="mt-3 inline-block rounded-lg bg-brand-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-brand-primary-dark"
            >
              Try again
            </button>
          </div>
        )}
      </div>

      <p className="mt-6 text-xs text-text-secondary">
        The download link expires after a few minutes for security. You can
        reload this page to generate a fresh one.
      </p>

      <Link
        href="/gallery"
        className="mt-4 inline-block text-sm text-text-secondary underline hover:text-text-primary"
      >
        Back to galleries
      </Link>
    </>
  );
}
