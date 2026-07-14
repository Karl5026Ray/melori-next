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
// the client's weighted shuffle. If the caller is logged out or has no signal,
// `foryou` transparently returns the plain pool with personalized:false so the
// UI can show a gentle hint instead of an empty state.
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const mode = url.searchParams.get("mode") === "foryou" ? "foryou" : "all";

    if (mode === "all") {
      const tracks = await getRadioPool();
      return NextResponse.json({ tracks, personalized: false, mode });
    }

    // For You: resolve the caller (Bearer token) the same way the stream routes do.
    let userId: string | null = null;
    try {
      const { userId: uid } = await getRequestMembership(request);
      userId = uid;
    } catch {
      userId = null;
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
