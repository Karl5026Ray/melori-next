import { NextResponse } from "next/server";
import { getRadioPool, getPersonalizedRadioPool } from "@/lib/data";
import { getRequestMembership } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// GET /api/radio/pool?mode=foryou|all
//
// Returns the Melori Radio track pool. `all` is every published track in the
// catalog (metadata only — audio is fetched per-track via the signed-URL
// stream endpoints at play time). `foryou` scores the same pool from the
// caller's follows + listen history and returns tracks carrying a `score` for
// the client's weighted shuffle.
//
// AUTHENTICATION IS REQUIRED, and it has to be.
//
// Since #353 the stream routes answer 401 to an unauthenticated caller. This
// endpoint used to hand the entire catalog to anyone, which meant a logged-out
// visitor received a full rotation whose every track then 401'd at play time.
// PlayerProvider.loadAndPlay treats a failed stream fetch as an unplayable
// track and, in radio mode, calls advanceRef() to skip it — so the player raced
// through the whole catalog, one 401 at a time, until deadSkips exceeded the
// queue length. With a few hundred tracks on air that is a visible stampede.
//
// Nobody had to press play for it, either: the homepage hero calls
// startRadio({ muted: true }) on mount.
//
// Refusing here means startRadio's own catch renders one honest message instead
// of a rotation that cannot possibly play.
export async function GET(request: Request) {
  try {
    let userId: string | null = null;
    try {
      const { userId: uid } = await getRequestMembership(request);
      userId = uid;
    } catch {
      userId = null;
    }

    if (!userId) {
      return NextResponse.json(
        { error: "Create a free account to listen", requiresAuth: true },
        { status: 401 },
      );
    }

    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") === "foryou" ? "foryou" : "all";

    if (mode === "all") {
      const tracks = await getRadioPool();
      return NextResponse.json({ tracks, personalized: false, mode });
    }

    const { tracks, personalized } = await getPersonalizedRadioPool(userId);
    return NextResponse.json({ tracks, personalized, mode });
  } catch (err) {
    console.error("GET /api/radio/pool failed:", err);
    return NextResponse.json(
      { error: "Failed to load radio pool" },
      { status: 500 },
    );
  }
}
