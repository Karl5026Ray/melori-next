import { NextResponse } from "next/server";
import { getPublicShows } from "@/lib/shows";

export const runtime = "nodejs";
export const revalidate = 60;

// GET /api/shows — the published Melori Radio shows. Public: shows are free to
// everyone (src/lib/shows.ts). Catalog facts only, never a storage path.
export async function GET() {
  try {
    return NextResponse.json({ shows: await getPublicShows() });
  } catch (err) {
    console.error("GET /api/shows failed:", err);
    return NextResponse.json({ shows: [] });
  }
}
