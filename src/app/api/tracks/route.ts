import { NextResponse } from "next/server";

// GET tracks by release — full implementation in Phase 1, Step 3.
export async function GET() {
  return NextResponse.json({ tracks: [] });
}
