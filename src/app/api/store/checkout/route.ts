import { NextResponse } from "next/server";

// The merch store was removed from Melori entirely; there is no payment
// mechanism left on the platform. This endpoint is kept only so old clients
// get a clean, explicit response instead of a 404.
export async function POST() {
    return NextResponse.json(
      { error: "The store has been removed. Melori is free." },
      { status: 410 }
        );
}
