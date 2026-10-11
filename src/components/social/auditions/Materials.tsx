"use client";

import { useRef, useState } from "react";
import { FileText, Image as ImageIcon, Link2, Loader2, Trash2, Upload } from "lucide-react";
import { auditionsApi, type AuditionFile } from "./api";

const KIND_LABEL: Record<AuditionFile["kind"], string> = {
  script: "Script",
  headshot: "Headshot",
  resume: "Resume",
  reel: "Reel",
};

/** Open a file in a new tab via a short-lived signed link. */
export async function openFile(roomId: string, file: AuditionFile, download = false) {
  // Open the tab inside the tap (pop-up blockers), then point it at the link.
  // (No "noopener" feature: with it window.open returns null and we would lose
  // the handle; the opener link is cut by hand instead.)
  const tab = window.open("", "_blank");
  if (tab) tab.opener = null;
  try {
    const { url } = await auditionsApi.fileUrl(roomId, file.id, download);
    // Never navigate THIS tab: it would drop the live room.
    if (tab) tab.location.href = url;
    else alert("Allow pop-ups for melorimusic.org to open files.");
  } catch {
    tab?.close();
    alert("Couldn't open that file.");
  }
}

export function FileRow({
  roomId,
  file,
  onDelete,
}: {
  roomId: string;
  file: AuditionFile;
  onDelete?: () => void;
}) {
  const Icon = file.kind === "headshot" ? ImageIcon : file.kind === "reel" ? Link2 : FileText;
  return (
    <li className="flex items-center gap-2 rounded-lg bg-melori-elevated px-3 py-2">
      <Icon className="h-4 w-4 shrink-0 text-melori-teal" />
      <button
        type="button"
        onClick={() => openFile(roomId, file)}
        className="min-w-0 flex-1 truncate text-left text-sm hover:underline"
      >
        <span className="text-melori-muted">{KIND_LABEL[file.kind]}:</span> {file.file_name ?? "file"}
      </button>
      {onDelete && (
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Remove ${KIND_LABEL[file.kind]}`}
          className="flex min-h-9 min-w-9 items-center justify-center rounded-md text-melori-muted hover:text-melori-danger"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </li>
  );
}

/** The actor's own materials: headshot, resume, reel link. Only the director sees them. */
export function MyMaterials({
  roomId,
  files,
  meId,
  onChanged,
}: {
  roomId: string;
  files: AuditionFile[];
  meId: string;
  onChanged: () => void;
}) {
  const mine = files.filter((f) => f.owner_id === meId && f.kind !== "script");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reel, setReel] = useState("");
  const headshotRef = useRef<HTMLInputElement>(null);
  const resumeRef = useRef<HTMLInputElement>(null);

  async function upload(kind: "headshot" | "resume", file: File | undefined) {
    if (!file) return;
    setBusy(kind);
    setError(null);
    try {
      await auditionsApi.upload(roomId, kind, file);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function addReel() {
    setBusy("reel");
    setError(null);
    try {
      await auditionsApi.addReel(roomId, reel);
      setReel("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-melori-border bg-melori-surface p-4">
      <h2 className="text-sm font-semibold">Your materials</h2>
      <p className="mt-1 text-xs text-melori-muted">
        Only the director sees these. They&apos;re deleted when the session ends.
      </p>

      {mine.length > 0 && (
        <ul className="mt-3 space-y-2">
          {mine.map((f) => (
            <FileRow
              key={f.id}
              roomId={roomId}
              file={f}
              onDelete={async () => {
                await auditionsApi.deleteFile(roomId, f.id).catch(() => undefined);
                onChanged();
              }}
            />
          ))}
        </ul>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <input
          ref={headshotRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => upload("headshot", e.target.files?.[0])}
        />
        <input
          ref={resumeRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => upload("resume", e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => headshotRef.current?.click()}
          disabled={busy !== null}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-melori-elevated text-sm disabled:opacity-50"
        >
          {busy === "headshot" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Headshot
        </button>
        <button
          type="button"
          onClick={() => resumeRef.current?.click()}
          disabled={busy !== null}
          className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-melori-elevated text-sm disabled:opacity-50"
        >
          {busy === "resume" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          Resume (PDF)
        </button>
      </div>

      <div className="mt-2 flex gap-2">
        <input
          type="url"
          inputMode="url"
          value={reel}
          onChange={(e) => setReel(e.target.value)}
          placeholder="Reel link (YouTube, Vimeo, Drive)"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-melori-border bg-melori-void px-3 text-sm focus:border-melori-purple focus:outline-none"
        />
        <button
          type="button"
          onClick={addReel}
          disabled={!reel.trim() || busy !== null}
          className="min-h-11 rounded-xl bg-melori-purple px-4 text-sm font-medium disabled:opacity-50"
        >
          {busy === "reel" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-melori-danger">{error}</p>}
    </section>
  );
}
