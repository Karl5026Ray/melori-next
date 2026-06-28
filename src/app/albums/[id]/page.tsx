export default function AlbumDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="max-w-6xl mx-auto px-6 py-16">
      <h1 className="text-3xl font-bold">Album</h1>
      <p className="mt-2 text-text-secondary">
        Album detail for <span className="text-brand-primary">{params.id}</span>{" "}
        coming in a later step. (Phase 1, Step 4)
      </p>
    </div>
  );
}
