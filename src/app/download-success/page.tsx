/**
 * /download-success — Stripe Checkout success landing page.
 *
 * VPS Stripe sessions are created with:
 *   success_url: https://melorimusic.org/download-success.html?session_id={CHECKOUT_SESSION_ID}
 *
 * Stripe rewrites {CHECKOUT_SESSION_ID} and lands the user here. We strip the
 * `.html` via vercel.json/next so /download-success.html and /download-success
 * both resolve to this page.
 *
 * Flow (all client-side because we use the session_id from the URL):
 *   1. Read ?session_id=cs_live_...
 *   2. GET /api/purchase/verify?session_id=...  → inserts purchases row, returns download_token
 *   3. GET /api/purchase/info/:token            → manifest of tracks + download links
 *   4. Render the download links (each link hits /api/download/:token?track_id=N)
 */
"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

interface ManifestTrack {
  id: number;
  title: string;
  track_number: number | null;
  available: boolean;
  download_url?: string | null;
}

interface PurchaseManifest {
  type: "track" | "release" | "album_manifest";
  release_title?: string;
  artist?: string;
  tracks: ManifestTrack[];
  download_count?: number;
  download_limit?: number;
  available_count?: number;
  total_count?: number;
}

function DownloadSuccessInner() {
  const params = useSearchParams();
  const sessionId = params.get("session_id");

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [manifest, setManifest] = useState<PurchaseManifest | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setStatus("error");
      setErrorMsg("Missing session_id. If you just paid and see this, contact support.");
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        // Step 1: verify the Stripe session and record the purchase
        const verifyRes = await fetch(
          `/api/purchase/verify?session_id=${encodeURIComponent(sessionId)}`,
          { method: "GET" },
        );
        if (!verifyRes.ok) {
          const text = await verifyRes.text().catch(() => "");
          throw new Error(
            `Verify failed (${verifyRes.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
          );
        }
        const verifyData = (await verifyRes.json()) as { download_token?: string };
        if (!verifyData.download_token) {
          throw new Error("Verify response missing download_token");
        }
        if (cancelled) return;
        setToken(verifyData.download_token);

        // Step 2: fetch the manifest of what was bought
        const infoRes = await fetch(`/api/purchase/info/${verifyData.download_token}`);
        if (!infoRes.ok) {
          const text = await infoRes.text().catch(() => "");
          throw new Error(
            `Info failed (${infoRes.status})${text ? `: ${text.slice(0, 200)}` : ""}`,
          );
        }
        const infoData = (await infoRes.json()) as PurchaseManifest;
        if (cancelled) return;
        setManifest(infoData);
        setStatus("ready");
      } catch (err) {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Something went wrong");
        setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-bold">Thank you for your purchase</h1>
      <p className="mt-2 text-text-secondary">
        Your download is ready below. Bookmark this page — your download link
        works for up to 10 downloads.
      </p>

      {status === "loading" && (
        <div className="mt-8 rounded-md border border-white/10 bg-white/5 p-6">
          <p>Confirming your payment with Stripe…</p>
        </div>
      )}

      {status === "error" && (
        <div className="mt-8 rounded-md border border-red-500/40 bg-red-500/10 p-6">
          <p className="font-semibold text-red-300">We couldn't complete your download.</p>
          <p className="mt-2 text-sm text-text-secondary">
            Your payment may still have gone through. Please email{" "}
            <a
              className="underline hover:text-brand-primary"
              href="mailto:support@melorimusic.org"
            >
              support@melorimusic.org
            </a>{" "}
            with the session id below and we'll send your files.
          </p>
          {sessionId && (
            <p className="mt-2 break-all font-mono text-xs text-text-secondary">
              session_id: {sessionId}
            </p>
          )}
          {errorMsg && (
            <p className="mt-2 break-all font-mono text-xs text-text-secondary">
              {errorMsg}
            </p>
          )}
        </div>
      )}

      {status === "ready" && manifest && token && (
        <div className="mt-8 rounded-md border border-white/10 bg-white/5 p-6">
          <h2 className="text-xl font-bold">
            {manifest.release_title}
            {manifest.artist && (
              <span className="text-text-secondary"> — {manifest.artist}</span>
            )}
          </h2>

          {manifest.type === "release" && manifest.tracks.length > 1 && (
            <a
              href={`/api/download/${token}?all=1`}
              className="mt-4 inline-flex items-center justify-center rounded-md bg-brand-primary px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-primary/90"
              download
            >
              Download all tracks (.zip)
            </a>
          )}

          <ul className="mt-6 divide-y divide-white/10">
            {manifest.tracks.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-3">
                <span className="text-sm">
                  {t.track_number != null && (
                    <span className="mr-2 text-text-secondary">
                      {String(t.track_number).padStart(2, "0")}.
                    </span>
                  )}
                  {t.title}
                </span>
                {t.available ? (
                  <a
                    href={
                      manifest.type === "track"
                        ? `/api/download/${token}`
                        : `/api/download/${token}?track_id=${t.id}`
                    }
                    className="text-sm font-semibold text-brand-primary hover:underline"
                    download
                  >
                    Download
                  </a>
                ) : (
                  <span className="text-sm text-text-secondary">Not yet available</span>
                )}
              </li>
            ))}
          </ul>

          {typeof manifest.download_count === "number" &&
            typeof manifest.download_limit === "number" && (
              <p className="mt-6 text-xs text-text-secondary">
                Downloads used: {manifest.download_count} of {manifest.download_limit}
              </p>
            )}

          <p className="mt-6 text-sm">
            <Link href="/" className="text-brand-primary hover:underline">
              ← Back to MELORI Music
            </Link>
          </p>
        </div>
      )}
    </main>
  );
}

export default function DownloadSuccessPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-2xl px-6 py-16">
          <h1 className="text-3xl font-bold">Thank you for your purchase</h1>
          <p className="mt-4 text-text-secondary">Loading…</p>
        </main>
      }
    >
      <DownloadSuccessInner />
    </Suspense>
  );
}
