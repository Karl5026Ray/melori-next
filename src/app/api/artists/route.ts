import { NextResponse } from "next/server";

// GET all published artists — full implementation in Phase 1, Step 3.
export async function GET() {
  return NextResponse.json({ artists: [] });
}
