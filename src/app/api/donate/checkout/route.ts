import { NextResponse } from "next/server";

// Donations were removed from Melori entirely (no payment mechanism of any
// kind remains on the platform). This endpoint is kept only so old clients
// calling it get a clean, explicit response instead of a 404.
export async function POST() {
    return NextResponse.json(
      { error: "Donations have been removed. Melori is free." },
      { status: 410 }
        );
}
