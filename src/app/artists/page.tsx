import ArtistCard from "@/components/ArtistCard";
import { getArtists } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Artists — MELORI MUSIC",
  description: "Discover independent artists on MELORI Music.",
};

export default async function ArtistsPage() {
  const artists = await getArtists().catch(() => []);

  return (
    <div className="max-w-6xl mx-auto px-6 py-12">
      <h1 className="text-3xl font-bold">Artists</h1>
      <p className="mt-2 mb-8 text-text-secondary">
        Discover the independent artists on MELORI Music.
      </p>

      {artists.length === 0 ? (
        <p className="text-text-secondary">No artists published yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {artists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} />
          ))}
        </div>
      )}
    </div>
  );
}
