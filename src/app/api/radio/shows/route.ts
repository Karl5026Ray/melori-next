import { NextResponse } from "next/server";
import { getRadioShows } from "@/lib/data";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/radio/shows — the recorded Melori Radio shows (studio_tracks with
// type 'show'), grouped by the client on `album` (one show = one album, each
// hour a part). Sign-in required for the same reason as /api/radio/pool: the
// stream routes 401 a stranger, so a list they cannot play is no use to them.
export async function GET(request: Request) {
  try {
    let userId: string | null = null;
    try {
      ({ userId } = await getRequestMembership(request));
    } catch {
      userId = null;
    }
    if (!userId) {
      return NextResponse.json(
        { error: "Create a free account to listen", requiresAuth: true },
        { status: 401 },
      );
    }
    return NextResponse.json({ shows: await getRadioShows() });
  } catch (err) {
    console.error("GET /api/radio/shows failed:", err);
    return NextResponse.json({ error: "Failed to load shows" }, { status: 500 });
  }
}
