import { AuditionRoomScreen } from "@/components/social/auditions/AuditionRoomScreen";

// MM Auditions room. Access is decided server-side (/api/auditions/[id] and
// the LiveKit token route), so this page renders the client screen only.
export default async function AuditionRoomPage({
  params,
}: {
  params: Promise<{ roomId: string }>;
}) {
  const { roomId } = await params;
  return <AuditionRoomScreen roomId={roomId} />;
}
