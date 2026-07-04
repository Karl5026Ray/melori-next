"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Artist {
  id: number;
  name: string;
  slug: string | null;
  bio: string | null;
  avatar_url: string | null;
  cover_image_url: string | null;
  is_verified: boolean;
  is_published: boolean;
  is_featured?: boolean;
  featured_order?: number | null;
}

type View = "list" | "form";

const emptyForm = {
  id: null as number | null,
  name: "",
  slug: "",
  bio: "",
  avatar_url: "",
  cover_image_url: "",
  is_verified: false,
  is_published: false,
  is_featured: false,
  featured_order: "",
};

export default function AdminArtistsPage() {
  const router = useRouter();
  const [view, setView] = useState<View>("list");
  const [artists, setArtists] = useState<Artist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState({ ...emptyForm });
  const [saving, setSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const loadArtists = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/artists", { cache: "no-store" });
      if (res.status === 401) {
        router.push("/admin");
        return;
      }
      const data = await res.json();
      setArtists(data.artists ?? []);
      setError(null);
    } catch {
      setError("Failed to load artists.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    loadArtists();
  }, [loadArtists]);

  const openCreate = () => {
    setForm({ ...emptyForm });
    setView("form");
  };

  const openEdit = (a: Artist) => {
    setForm({
      id: a.id,
      name: a.name ?? "",
      slug: a.slug ?? "",
      bio: a.bio ?? "",
      avatar_url: a.avatar_url ?? "",
      cover_image_url: a.cover_image_url ?? "",
      is_verified: a.is_verified,
      is_published: a.is_published,
      is_featured: Boolean(a.is_featured),
      featured_order:
        a.featured_order === null || a.featured_order === undefined
          ? ""
          : String(a.featured_order),
    });
    setUploadError(null);
    setView("form");
  };

  const uploadPhoto = async (
    field: "avatar_url" | "cover_image_url",
    file: File,
  ) => {
    setUploadError(null);
    if (!file.type.startsWith("image/")) {
      setUploadError("Please choose an image file (JPEG, PNG, WebP).");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("Image must be 10 MB or smaller.");
      return;
    }

    setUploadingPhoto(true);
    try {
      // Step 1: request a short-lived signed upload URL from our admin API.
      const urlRes = await fetch("/api/admin/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, type: "cover" }),
      });
      if (!urlRes.ok) {
        if (urlRes.status === 401) {
          throw new Error(
            "Your admin session expired. Please log in again.",
          );
        }
        const d = await urlRes.json().catch(() => ({}));
        throw new Error(
          d.error ?? `Could not get upload URL (${urlRes.status}).`,
        );
      }
      const { signedUrl, publicUrl } = await urlRes.json();

      // Step 2: PUT the file to Supabase Storage. `x-upsert` lets a repeat
      // upload for the same path replace the old object cleanly.
      const putRes = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
          "x-upsert": "true",
        },
      });
      if (!putRes.ok) {
        const text = await putRes.text().catch(() => "");
        console.error("Supabase upload failed:", putRes.status, text);
        throw new Error(
          `Upload failed (${putRes.status}). ${
            text || "Check bucket permissions."
          }`,
        );
      }
      setForm((f) => ({ ...f, [field]: publicUrl }));
    } catch (err: any) {
      setUploadError(err?.message ?? "Photo upload failed.");
    } finally {
      setUploadingPhoto(false);
    }
  };

  const save = async () => {
    if (!form.name.trim()) {
      alert("Name is required.");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, any> = {
        name: form.name.trim(),
        slug: form.slug.trim(),
        bio: form.bio,
        avatar_url: form.avatar_url || null,
        cover_image_url: form.cover_image_url || null,
        is_verified: form.is_verified,
        is_published: form.is_published,
        is_featured: form.is_featured,
      };
      const orderStr = String(form.featured_order ?? "").trim();
      payload.featured_order =
        orderStr === "" ? null : Number(orderStr);
      const res = await fetch(
        form.id ? `/api/admin/artists/${form.id}` : "/api/admin/artists",
        {
          method: form.id ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error ?? "Save failed");
      }
      setView("list");
      await loadArtists();
    } catch (err: any) {
      alert(err?.message ?? "Could not save artist.");
    } finally {
      setSaving(false);
    }
  };

  const deleteArtist = async (a: Artist) => {
    if (!confirm(`Delete "${a.name}"? This cannot be undone.`)) return;
    try {
      const res = await fetch(`/api/admin/artists/${a.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
      setArtists((prev) => prev.filter((x) => x.id !== a.id));
    } catch {
      alert("Could not delete artist.");
    }
  };

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="border-b border-white/[0.06] px-6 md:px-10 py-5 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard" className="text-sm text-[#888] hover:text-[#c9a96e]">
            ← Dashboard
          </Link>
          <h1 className="text-xl font-bold">Artist Manager</h1>
        </div>
        {view === "list" && (
          <button
            onClick={openCreate}
            className="px-5 py-2.5 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl"
          >
            + New artist
          </button>
        )}
      </header>

      <main className="p-6 md:p-10 max-w-5xl mx-auto">
        {view === "list" && (
          <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl overflow-hidden">
            {loading ? (
              <div className="p-10 text-center text-[#888]">Loading artists…</div>
            ) : error ? (
              <div className="p-10 text-center text-red-400">{error}</div>
            ) : artists.length === 0 ? (
              <div className="p-10 text-center text-[#888]">
                No artists yet. Click “New artist” to add one.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-[#888] border-b border-white/[0.06]">
                    <th className="px-5 py-3 font-medium">Artist</th>
                    <th className="px-5 py-3 font-medium">Verified</th>
                    <th className="px-5 py-3 font-medium">Published</th>
                    <th className="px-5 py-3 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {artists.map((a) => (
                    <tr key={a.id} className="border-b border-white/[0.04]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={a.avatar_url || "/placeholder-avatar.png"}
                            alt=""
                            className="w-9 h-9 rounded-full object-cover bg-white/10"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.visibility =
                                "hidden";
                            }}
                          />
                          <div>
                            <div className="font-medium">{a.name}</div>
                            <div className="text-xs text-[#666]">{a.slug}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3">{a.is_verified ? "✓" : "—"}</td>
                      <td className="px-5 py-3">
                        <span
                          className={`px-3 py-1 rounded-full text-xs font-semibold ${
                            a.is_published
                              ? "bg-green-500/15 text-green-400"
                              : "bg-white/10 text-[#888]"
                          }`}
                        >
                          {a.is_published ? "Published" : "Draft"}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex gap-2 justify-end">
                          <button
                            onClick={() => openEdit(a)}
                            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs hover:border-[#c9a96e]/40"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteArtist(a)}
                            className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-xs text-red-400 hover:border-red-400/40"
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {view === "form" && (
          <div className="max-w-2xl mx-auto space-y-6">
            <button
              onClick={() => setView("list")}
              className="text-sm text-[#888] hover:text-[#c9a96e]"
            >
              ← Back to artists
            </button>

            <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6 space-y-4">
              <h2 className="text-lg font-bold">
                {form.id ? "Edit artist" : "New artist"}
              </h2>

              <div>
                <label className="text-sm text-[#888] block mb-1">Name *</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#c9a96e]/50"
                  placeholder="Artist name"
                />
              </div>

              <div>
                <label className="text-sm text-[#888] block mb-1">
                  Slug (optional — auto from name)
                </label>
                <input
                  value={form.slug}
                  onChange={(e) => setForm((f) => ({ ...f, slug: e.target.value }))}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#c9a96e]/50"
                  placeholder="artist-slug"
                />
              </div>

              <div>
                <label className="text-sm text-[#888] block mb-1">Bio</label>
                <textarea
                  value={form.bio}
                  onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
                  rows={4}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#c9a96e]/50"
                  placeholder="Short artist biography"
                />
              </div>

              <div>
                <label className="text-sm text-[#888] block mb-1">
                  Profile photo (avatar)
                </label>
                <div className="flex items-center gap-4">
                  {form.avatar_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.avatar_url}
                      alt=""
                      className="w-16 h-16 rounded-full object-cover bg-white/10"
                    />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingPhoto}
                    onChange={(e) =>
                      e.target.files?.[0] &&
                      uploadPhoto("avatar_url", e.target.files[0])
                    }
                    className="text-sm text-[#888] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-white/5 file:text-white hover:file:bg-white/10 disabled:opacity-50"
                  />
                </div>
              </div>

              <div>
                <label className="text-sm text-[#888] block mb-1">
                  Cover image (optional)
                </label>
                <div className="flex items-center gap-4">
                  {form.cover_image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={form.cover_image_url}
                      alt=""
                      className="w-24 h-16 rounded-lg object-cover bg-white/10"
                    />
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    disabled={uploadingPhoto}
                    onChange={(e) =>
                      e.target.files?.[0] &&
                      uploadPhoto("cover_image_url", e.target.files[0])
                    }
                    className="text-sm text-[#888] file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:bg-white/5 file:text-white hover:file:bg-white/10 disabled:opacity-50"
                  />
                </div>
                {uploadingPhoto && (
                  <p className="text-xs text-[#c9a96e] mt-2">Uploading photo…</p>
                )}
                {uploadError && (
                  <p className="text-xs text-red-400 mt-2">{uploadError}</p>
                )}
              </div>

              <div className="flex gap-6 flex-wrap">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.is_verified}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, is_verified: e.target.checked }))
                    }
                    className="accent-[#c9a96e] w-4 h-4"
                  />
                  Verified
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.is_published}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, is_published: e.target.checked }))
                    }
                    className="accent-[#c9a96e] w-4 h-4"
                  />
                  Published
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.is_featured}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        is_featured: e.target.checked,
                      }))
                    }
                    className="accent-[#c9a96e] w-4 h-4"
                  />
                  Featured on /featured-artist
                </label>
              </div>

              {form.is_featured && (
                <div>
                  <label className="text-sm text-[#888] block mb-1">
                    Featured order (lower = shown first, blank = end)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={form.featured_order}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        featured_order: e.target.value,
                      }))
                    }
                    className="w-full max-w-[16rem] bg-white/5 border border-white/10 rounded-xl px-4 py-3 outline-none focus:border-[#c9a96e]/50"
                    placeholder="e.g. 1"
                  />
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setView("list")}
                disabled={saving}
                className="px-5 py-2.5 bg-white/5 border border-white/10 rounded-xl font-semibold disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving || uploadingPhoto}
                className="px-6 py-2.5 bg-gradient-to-r from-[#c9a96e] to-[#a08050] text-[#0a0a0a] font-bold rounded-xl disabled:opacity-50"
              >
                {saving ? "Saving…" : form.id ? "Save changes" : "Create artist"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
