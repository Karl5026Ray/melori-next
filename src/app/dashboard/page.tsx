"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { authFetch } from "@/lib/authClient";

type Submission = {
  id: string;
  title: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
  reviewed_at: string | null;
  reviewer_notes: string | null;
  release_type: string;
};

type Release = {
  id: number;
  title: string;
  slug: string;
  cover_art_url: string | null;
  release_type: string;
  release_date: string | null;
  is_published: boolean;
};

type ArtistRow = {
  id: number;
  name: string;
  slug: string;
  avatar_url: string | null;
  is_featured: boolean | null;
  is_verified: boolean | null;
};

type Stats = {
  artist: ArtistRow | null;
  totals: { releases: number; tracks: number; pending: number };
  releases: Release[];
  submissions: Submission[];
};

export default function ArtistDashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        router.replace("/social/auth?next=/dashboard");
        return;
      }
      try {
        const res = await authFetch("/api/artist/stats");
        if (res.status === 403) {
          setError("Artist membership required. Upgrade at /membership to unlock the dashboard.");
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as Stats;
        if (!cancelled) {
          setStats(json);
          setLoading(false);
        }
      } catch (err: any) {
        console.error(err);
        if (!cancelled) {
          setError("Failed to load dashboard.");
          setLoading(false);
        }
      }
    }
    void load();

    return () => {
      cancelled = true;
    };
  }, [router]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-brand-primary/20 border-t-brand-primary rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <h1 className="text-2xl font-bold mb-3">Dashboard unavailable</h1>
        <p className="text-text-secondary mb-6">{error}</p>
        <Link
          href="/membership"
          className="inline-block px-6 py-3 bg-brand-primary text-black font-semibold rounded-lg"
        >
          View membership options
        </Link>
      </div>
    );
  }

  const s = stats!;
  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">
            {s.artist ? `Welcome back, ${s.artist.name}` : "Your artist dashboard"}
          </h1>
          <p className="text-text-secondary mt-1">
            {s.artist
              ? "Manage releases, submit new tracks, and track your catalog."
              : "Your Supabase profile isn't linked to an artist row yet. Ask an admin to link you so releases appear here."}
          </p>
        </div>
        <Link
          href="/upload"
          className="inline-flex items-center justify-center px-5 py-3 rounded-lg bg-brand-primary text-black font-semibold"
        >
          Submit a new track
        </Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-10">
        <StatCard label="Published releases" value={s.totals.releases} />
        <StatCard label="Tracks in catalog" value={s.totals.tracks} />
        <StatCard label="Pending review" value={s.totals.pending} />
      </div>

      <section className="mb-10">
        <h2 className="text-xl font-semibold mb-4">Your releases</h2>
        {s.releases.length === 0 ? (
          <p className="text-text-secondary">
            No releases yet. Submit a track and once it's approved it'll show up here.
          </p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            {s.releases.map((r) => (
              <Link
                key={r.id}
                href={`/albums/${r.slug}`}
                className="block rounded-lg overflow-hidden bg-brand-surface border border-brand-border hover:border-brand-primary transition"
              >
                <div className="aspect-square bg-black/40 relative">
                  {r.cover_art_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.cover_art_url} alt={r.title} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-text-secondary">
                      No art
                    </div>
                  )}
                  {!r.is_published && (
                    <span className="absolute top-2 left-2 text-[10px] uppercase tracking-wide bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded">
                      Draft
                    </span>
                  )}
                </div>
                <div className="p-2">
                  <div className="text-sm font-medium truncate">{r.title}</div>
                  <div className="text-xs text-text-secondary capitalize">{r.release_type}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-xl font-semibold mb-4">Submissions</h2>
        {s.submissions.length === 0 ? (
          <p className="text-text-secondary">No submissions yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-text-secondary">
                <tr>
                  <th className="py-2 pr-4">Title</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Status</th>
                  <th className="py-2 pr-4">Submitted</th>
                  <th className="py-2 pr-4">Reviewer notes</th>
                </tr>
              </thead>
              <tbody>
                {s.submissions.map((sub) => (
                  <tr key={sub.id} className="border-t border-brand-border/50">
                    <td className="py-2 pr-4 font-medium">{sub.title}</td>
                    <td className="py-2 pr-4 capitalize">{sub.release_type}</td>
                    <td className="py-2 pr-4">
                      <StatusPill status={sub.status} />
                    </td>
                    <td className="py-2 pr-4 text-text-secondary">
                      {new Date(sub.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2 pr-4 text-text-secondary">
                      {sub.reviewer_notes ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-brand-surface border border-brand-border px-5 py-4">
      <div className="text-2xl font-bold">{value.toLocaleString()}</div>
      <div className="text-sm text-text-secondary mt-1">{label}</div>
    </div>
  );
}

function StatusPill({ status }: { status: Submission["status"] }) {
  const styles: Record<Submission["status"], string> = {
    pending: "bg-yellow-500/15 text-yellow-300",
    approved: "bg-green-500/15 text-green-300",
    rejected: "bg-red-500/15 text-red-300",
  };
  return (
    <span className={`px-2 py-0.5 rounded text-xs uppercase tracking-wide ${styles[status]}`}>
      {status}
    </span>
  );
}
