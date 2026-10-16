// schema.org structured data for search engines (MusicGroup, MusicAlbum).
//
// It describes the same facts the page shows, never more: structured data that
// disagrees with the visible page is treated by Google as spam. `<` is escaped
// so a title like "</script>" cannot close the tag early.
export default function JsonLd({ data }: { data: Record<string, unknown> }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
