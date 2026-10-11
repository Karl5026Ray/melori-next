"use client";

// The shared script. Renders ONE page of a PDF to a canvas with pdf.js.
//
// Not an <iframe>: the site CSP doesn't allow framing Supabase storage, and
// iOS Safari shows only page 1 of a framed PDF and ignores #page=N, which would
// break "the director turns the page for the room" on the phones most actors
// will use. The legacy build is used for older iOS WebViews.

import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";

type PdfDoc = { numPages: number; getPage: (n: number) => Promise<any>; destroy: () => void };

let pdfjsPromise: Promise<any> | null = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export function ScriptViewer({
  url,
  page,
  canTurn,
  onTurn,
}: {
  /** Signed URL; changes when re-signed, which reloads the document. */
  url: string;
  page: number;
  /** Director only: shows the page controls. Readers follow `page`. */
  canTurn: boolean;
  onTurn?: (page: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [doc, setDoc] = useState<PdfDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loaded: PdfDoc | null = null;
    setDoc(null);
    setError(null);
    loadPdfjs()
      .then((pdfjs) => pdfjs.getDocument({ url, isEvalSupported: false }).promise)
      .then((d: PdfDoc) => {
        loaded = d;
        if (!cancelled) setDoc(d);
      })
      .catch(() => !cancelled && setError("Couldn't open the script"));
    return () => {
      cancelled = true;
      loaded?.destroy();
    };
  }, [url]);

  const shownPage = doc ? Math.min(Math.max(1, page), doc.numPages) : page;

  useEffect(() => {
    if (!doc || !canvasRef.current || !wrapRef.current) return;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    let cancelled = false;
    setRendering(true);
    doc
      .getPage(shownPage)
      .then((p) => {
        if (cancelled || !canvasRef.current || !wrapRef.current) return;
        const base = p.getViewport({ scale: 1 });
        const width = wrapRef.current.clientWidth || base.width;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const viewport = p.getViewport({ scale: (width / base.width) * dpr });
        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${viewport.width / dpr}px`;
        canvas.style.height = `${viewport.height / dpr}px`;
        task = p.render({ canvasContext: canvas.getContext("2d")!, viewport });
        return task!.promise;
      })
      .catch(() => undefined)
      .finally(() => !cancelled && setRendering(false));
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, shownPage]);

  return (
    <div className="flex h-full flex-col">
      <div ref={wrapRef} className="relative flex-1 overflow-y-auto rounded-xl bg-white">
        {error ? (
          <p className="p-6 text-center text-sm text-melori-danger">{error}</p>
        ) : (
          <canvas ref={canvasRef} className="block" aria-label={`Script page ${shownPage}`} />
        )}
        {(!doc || rendering) && !error && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-melori-purple" />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-sm">
        {canTurn ? (
          <button
            type="button"
            onClick={() => onTurn?.(shownPage - 1)}
            disabled={shownPage <= 1}
            aria-label="Previous page"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-melori-elevated disabled:opacity-40"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <span className="text-xs text-melori-muted">The director turns the pages</span>
        )}
        <span className="text-melori-muted">
          Page {shownPage}
          {doc ? ` of ${doc.numPages}` : ""}
        </span>
        {canTurn && (
          <button
            type="button"
            onClick={() => onTurn?.(shownPage + 1)}
            disabled={!doc || shownPage >= doc.numPages}
            aria-label="Next page"
            className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-melori-elevated disabled:opacity-40"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        )}
      </div>
    </div>
  );
}
