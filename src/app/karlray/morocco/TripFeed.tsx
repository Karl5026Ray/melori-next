"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";

export interface TripPost {
  id: string;
  imageUrl: string;
  caption: string | null;
  createdAt: string;
}

const dateFmt = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "America/Chicago",
});

// The trip feed: newest photo first, its caption underneath as the update.
// The owner (Karl) gets a text box under each photo to write or change the
// caption. The PATCH route checks ownership server-side; showing the box only
// to the owner is convenience, not security.
export default function TripFeed({ ownerId, posts }: { ownerId: string; posts: TripPost[] }) {
  const [isOwner, setIsOwner] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (alive) setIsOwner(data.session?.user.id === ownerId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ownerId]);

  return (
    <ol className="space-y-8">
      {posts.map((p) => (
        <li key={p.id} className="overflow-hidden rounded-2xl border border-brand-border bg-brand-surface">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.imageUrl}
            alt={p.caption || "Photo from Karl's Morocco trip"}
            loading="lazy"
            className="w-full object-cover"
          />
          <div className="p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
              {dateFmt.format(new Date(p.createdAt))}
            </p>
            {isOwner ? (
              <CaptionEditor post={p} />
            ) : (
              p.caption && <p className="mt-1 whitespace-pre-line leading-relaxed">{p.caption}</p>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}

function CaptionEditor({ post }: { post: TripPost }) {
  const [text, setText] = useState(post.caption ?? "");
  const [saved, setSaved] = useState(post.caption ?? "");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  const save = async () => {
    setState("saving");
    try {
      const res = await authFetch(`/api/studio/gallery/image/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption: text.trim() || null }),
      });
      if (!res.ok) throw new Error("save failed");
      setSaved(text.trim());
      setState("idle");
    } catch {
      setState("error");
    }
  };

  const dirty = text.trim() !== saved;

  return (
    <div className="mt-2">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={3}
        maxLength={1000}
        placeholder="Write the update for this photo…"
        className="w-full rounded-lg border border-brand-border bg-brand-background p-2 text-base"
      />
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || state === "saving"}
          className="rounded-full bg-brand-primary px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {state === "saving" ? "Saving…" : "Save update"}
        </button>
        {state === "error" && <span className="text-sm text-red-500">Didn&apos;t save. Try again.</span>}
        {!dirty && saved && state === "idle" && (
          <span className="text-sm text-text-secondary">Saved. Visitors see it within a minute.</span>
        )}
      </div>
    </div>
  );
}
