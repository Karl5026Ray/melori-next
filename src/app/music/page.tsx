import MusicCatalog from "@/components/MusicCatalog";
import { getReleases } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Music — MELORI MUSIC",
  description: "Browse the full MELORI music catalog.",
};

export default async function MusicPage() {
  const releases = await getReleases().catch(() => []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold">Music Catalog</h1>
      <p className="mt-2 mb-8 text-text-secondary">
        Browse every release on MELORI Music.
      </p>
      <MusicCatalog releases={releases} />
    </div>
  );
}
