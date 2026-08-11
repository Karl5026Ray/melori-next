// Concert Battle route.
//
// This is intentionally a data boundary, not a RoomScreen alias. A battle must
// never inherit generic Spaces stage controls while its dedicated two-slot
// screen and media policy are implemented in later pull requests.

import { ConcertBattleSetup } from "@/components/social/concert/ConcertBattleSetup";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ConcertBattlePage({
  params,
}: {
  params: Promise<{ spaceId: string }>;
}) {
  const { spaceId } = await params;
  return <ConcertBattleSetup spaceId={spaceId} />;
}
