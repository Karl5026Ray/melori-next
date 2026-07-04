"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_COVER_BYTES = 8 * 1024 * 1024; // 8 MB

const GENRES = ["R&B", "Hip-Hop", "Gospel", "Afrobeat", "Pop", "Electronic", "Jazz", "Other"];

export default function UploadPage() {
  const router = useRouter();
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);

  const [ready, setReady] = useState(false);
  const [gateError, setGateError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [releaseType, setReleaseType] = useState<"single" | "ep" | "album">("single");
  const [genre, setGenre] = useState("R&B");
  const [description, setDescription] = useState("");
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);

  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace("/social/auth?next=/upload");
        return;
      }
      // Cheap membership probe: hit the same guarded endpoint the dashboard uses.
      const res = await authFetch("/api/artist/stats");
      if (cancelled) return;
      if (res.status === 403) {
        setGateError("Artist membership required to upload. Upgrade at /membership.");
      } else if (!res.ok) {
        setGateError("Couldn't verify your membership. Try refreshing.");
      }
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const canSubmit =
    !uploading && title.trim().length > 0 && audioFile !== null && !gateError;

  async function uploadOne(file: File, kind: "audio" | "cover"): Promise<string> {
    setProgress(`Preparing ${kind} upload…`);
    const signRes = await authFetch("/api/artist/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, type: kind }),
    });
    if (!signRes.ok) throw new Error(`Could not get ${kind} upload URL`);
    const { signedUrl, publicUrl } = (await signRes.json()) as {
      signedUrl: string;
      publicUrl: string;
    };

    setProgress(`Uploading ${kind}…`);
    const putRes = await fetch(signedUrl, {
      method: "PUT",
      headers: { "x-upsert": "true", "content-type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!putRes.ok) throw new Error(`${kind} upload failed (${putRes.status})`);
    return publicUrl;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!audioFile) return;
    if (audioFile.size > MAX_AUDIO_BYTES) {
      setError("Audio file exceeds the 100 MB limit.");
      return;
    }
    if (coverFile && coverFile.size > MAX_COVER_BYTES) {
      setError("Cover image exceeds the 8 MB limit.");
      return;
    }

    setUploading(true);
    try {
      const audioUrl = await uploadOne(audioFile, "audio");
      const coverUrl = coverFile ? await uploadOne(coverFile, "cover") : null;

      setProgress("Submitting for review…");
      const res = await authFetch("/api/artist/submissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          release_type: releaseType,
          genre,
          description: description.trim() || null,
          audio_url: audioUrl,
          cover_url: coverUrl,
          file_size_bytes: audioFile.size,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Submission failed (${res.status})`);
      }
      setSuccess(true);
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
      setProgress("");
    }
  }

  if (!ready) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-primary/20 border-t-brand-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (gateError) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-bold mb-3">Upload locked</h1>
        <p className="text-text-secondary mb-6">{gateError}</p>
        <Link
          href="/membership"
          className="inline-block px-6 py-3 bg-brand-primary text-black font-semibold rounded-lg"
        >
          View membership
        </Link>
      </div>
    );
  }

  if (success) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-bold mb-2">Submission received</h1>
        <p className="text-text-secondary mb-6">
          Your track is in the admin review queue. You'll see it in your dashboard once it's approved.
        </p>
        <div className="flex justify-center gap-3">
          <Link
            href="/dashboard"
            className="px-5 py-2.5 rounded-lg bg-brand-primary text-black font-semibold"
          >
            Back to dashboard
          </Link>
          <button
            type="button"
            onClick={() => {
              setSuccess(false);
              setTitle("");
              setDescription("");
              setAudioFile(null);
              setCoverFile(null);
            }}
            className="px-5 py-2.5 rounded-lg border border-brand-border"
          >
            Submit another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <h1 className="text-3xl font-bold">Submit a track</h1>
      <p className="text-text-secondary mt-1 mb-8">
        Tracks are reviewed by a Melori admin before going live on the catalog.
      </p>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Field label="Title">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
            className="w-full rounded-md border border-input-border bg-brand-surface px-3 py-2"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Release type">
            <select
              value={releaseType}
              onChange={(e) => setReleaseType(e.target.value as any)}
              className="w-full rounded-md border border-input-border bg-brand-surface px-3 py-2"
            >
              <option value="single">Single</option>
              <option value="ep">EP</option>
              <option value="album">Album</option>
            </select>
          </Field>
          <Field label="Genre">
            <select
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              className="w-full rounded-md border border-input-border bg-brand-surface px-3 py-2"
            >
              {GENRES.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <Field label="Description (optional)">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
            rows={4}
            className="w-full rounded-md border border-input-border bg-brand-surface px-3 py-2"
          />
        </Field>

        <Field label="Audio file — MP3, WAV, or FLAC (max 100 MB)">
          <input
            ref={audioInputRef}
            type="file"
            accept="audio/mpeg,audio/wav,audio/x-wav,audio/flac,audio/mp3,audio/*"
            onChange={(e) => setAudioFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-brand-primary file:text-black file:font-semibold"
          />
          {audioFile && (
            <p className="text-xs text-text-secondary mt-1">
              {audioFile.name} · {(audioFile.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          )}
        </Field>

        <Field label="Cover art (optional — JPG or PNG, max 8 MB)">
          <input
            ref={coverInputRef}
            type="file"
            accept="image/jpeg,image/png"
            onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-text-secondary file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:bg-brand-primary file:text-black file:font-semibold"
          />
          {coverFile && (
            <p className="text-xs text-text-secondary mt-1">
              {coverFile.name} · {(coverFile.size / (1024 * 1024)).toFixed(1)} MB
            </p>
          )}
        </Field>

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 text-red-300 text-sm px-3 py-2">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-4">
          <Link href="/dashboard" className="text-sm text-text-secondary hover:text-white">
            ← Cancel
          </Link>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-6 py-3 rounded-lg bg-brand-primary text-black font-semibold disabled:opacity-50"
          >
            {uploading ? progress || "Uploading…" : "Submit for review"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm text-text-secondary mb-1">{label}</span>
      {children}
    </label>
  );
}
