// Concert Battle route.
//
// This is intentionally a data boundary, not a RoomScreen alias. A battle must
// never inherit generic Spaces stage controls while its dedicated two-slot
// screen and media policy are implemented in later pull requests.

import { notFound, redirect } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { roomHref } from "@/lib/cinema";
import { CONCERT_BATTLE_ROOM_FORMAT } from "@/lib/concertBattle";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConcertBattlePage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  const { data, error } = await supabase
    .from("spaces")
    .select("id, title, topic, room_format")
    .eq("id", spaceId)
    .maybeSingle();

  // Do not render a generic room on a failed/missing lookup. The battle route
  // will eventually fetch its dedicated aggregate through an authenticated API,
  // so this boundary is deliberately fail-closed from its first release.
  if (error || !data) notFound();

  // Preserve a copied/mistyped Concert URL for every other room format without
  // introducing another independent mapping of product routes.
  if (data.room_format !== CONCERT_BATTLE_ROOM_FORMAT) {
    redirect(roomHref(data));
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center p-6">
      <section
        className="w-full max-w-xl rounded-2xl border border-melori-border bg-melori-elevated/40 p-8 text-center shadow-xl"
        aria-labelledby="concert-battle-title"
      >
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.24em] text-melori-teal">
          Concert Battle
        </p>
        <h1 id="concert-battle-title" className="text-2xl font-bold">
          {data.title}
        </h1>
        {data.topic ? (
          <p className="mt-3 text-sm text-melori-muted">{data.topic}</p>
        ) : null}
        <p className="mt-6 text-sm text-melori-muted">
          The dedicated Concert Battle stage is being prepared. Generic Spaces
          controls are intentionally unavailable for this room.
        </p>
      </section>
    </main>
  );
}
