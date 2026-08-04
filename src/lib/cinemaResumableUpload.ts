// Resumable uploads for MM Cinema screenings.
//
// A Cinema source can be feature-length. The single-PUT path used everywhere
// else in the app (signed upload URL -> one request) has no recovery: a phone
// that switches from wifi to cellular at 92% of a 1.6 GB file starts again from
// zero. This module uses Supabase Storage's TUS endpoint instead, which tracks
// a byte offset server-side so an interrupted upload continues from where it
// stopped — across a network blip, a backgrounded tab, or a closed browser.
//
// AUTH DIFFERENCE, AND WHY IT MATTERS: the signed-URL path is authorised by the
// service role on the server. TUS authorises as the USER, with their own JWT,
// so it is governed by RLS on storage.objects. Migration 052 adds the policies
// that allow a member to write inside social/{their id}/ and nowhere else —
// the same namespacing /api/social/upload-url already enforces, so this grants
// no new authority.

import type { Upload as TusUpload } from "tus-js-client";
import { supabase } from "@/lib/supabase";

/** Supabase requires TUS chunks to be exactly 6 MB (the final chunk aside). */
const CHUNK_SIZE = 6 * 1024 * 1024;

/**
 * Below this, resumability isn't worth the extra round trips — a small file
 * either lands or fails fast, and the single PUT is simpler and quicker. Above
 * it, the odds of an interruption over a session long enough to matter stop
 * being negligible.
 */
export const RESUMABLE_THRESHOLD_BYTES = 50 * 1024 * 1024; // 50 MB

/** Ceiling for a Cinema source. The `social-videos` bucket itself is unlimited. */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

export const SOCIAL_VIDEOS_BUCKET = "social-videos";

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

/** Mirrors the server's sanitiser in /api/social/upload-url. */
export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]+/g, "_");
}

/**
 * Storage key for an upload. The `social/{userId}/` prefix is not cosmetic:
 * migration 052's RLS policies read those two segments to decide whether the
 * write is allowed, so this shape is load-bearing.
 */
export function buildObjectPath(userId: string, filename: string): string {
  return `social/${userId}/${Date.now()}_${sanitizeFilename(filename)}`;
}

/** Public playback URL for a finished object in the public bucket. */
export function publicUrlFor(path: string): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/storage/v1/object/public/${SOCIAL_VIDEOS_BUCKET}/${path}`;
}

function resumableEndpoint(): string {
  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/$/, "");
  return `${base}/storage/v1/upload/resumable`;
}

export interface ResumableHandle {
  /** Stop sending bytes. The server keeps the offset; `resume()` continues. */
  pause: () => void;
  resume: () => void;
  /** Give up AND discard the partial object on the server. */
  abort: () => Promise<void>;
}

export interface ResumableCallbacks {
  onProgress: (percent: number, uploadedBytes: number) => void;
  /** Fired when a previously interrupted upload is picked back up. */
  onResumeDetected?: (percentAlreadyDone: number) => void;
  onSuccess: (publicUrl: string, path: string) => void;
  onError: (message: string) => void;
}

/**
 * Starts (or transparently continues) a resumable upload.
 *
 * `path` must be stable across attempts for resumption to work — tus-js-client
 * fingerprints on file identity plus metadata, and Supabase keys the partial
 * upload by object name. Callers should therefore persist the path they got
 * from `buildObjectPath` rather than recomputing it, since it embeds a
 * timestamp.
 */
export async function startResumableUpload(
  file: File,
  path: string,
  callbacks: ResumableCallbacks,
): Promise<ResumableHandle> {
  // Imported lazily so tus-js-client is only pulled into the bundle when
  // someone actually uploads something big, rather than on every room load.
  const { Upload } = await import("tus-js-client");

  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sign in again to upload.");

  return new Promise<ResumableHandle>((resolve, reject) => {
    const upload: TusUpload = new Upload(file, {
      endpoint: resumableEndpoint(),
      retryDelays: [0, 1000, 3000, 5000, 10000, 20000],
      headers: {
        authorization: `Bearer ${token}`,
        // Replace a partial object of the same name rather than 409-ing, so a
        // retry after a hard failure isn't blocked by its own leftovers.
        "x-upsert": "true",
      },
      uploadDataDuringCreation: true,
      // Keeps the fingerprint in localStorage so an upload survives a closed
      // tab, not just a flaky connection.
      removeFingerprintOnSuccess: true,
      metadata: {
        bucketName: SOCIAL_VIDEOS_BUCKET,
        objectName: path,
        contentType: file.type || "video/mp4",
        cacheControl: "3600",
      },
      chunkSize: CHUNK_SIZE,
      onError: (err) => {
        callbacks.onError(
          err instanceof Error ? err.message : "Upload failed — try again.",
        );
      },
      onProgress: (uploaded, total) => {
        callbacks.onProgress(total > 0 ? (uploaded / total) * 100 : 0, uploaded);
      },
      onSuccess: () => {
        callbacks.onSuccess(publicUrlFor(path), path);
      },
    });

    upload
      .findPreviousUploads()
      .then((previous) => {
        if (previous.length > 0) {
          upload.resumeFromPreviousUpload(previous[0]);
          const done = Number(previous[0].size ?? 0);
          if (done > 0 && file.size > 0) {
            callbacks.onResumeDetected?.((done / file.size) * 100);
          }
        }
        upload.start();
        resolve({
          pause: () => upload.abort(),
          resume: () => void upload.start(),
          // `abort(true)` also tells the server to drop the partial object, so
          // an abandoned 2 GB upload doesn't sit in the bucket forever.
          abort: async () => {
            await upload.abort(true);
          },
        });
      })
      .catch(reject);
  });
}
