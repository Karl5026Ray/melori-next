import { NextResponse } from "next/server";

// Paid coin packs were removed from Melori entirely; there is no payment
// mechanism left on the platform. Free gift-sending in live rooms is
// untouched by this change. This endpoint is kept only so old clients get a
// clean, explicit response instead of a 404.
export async function POST() {
    return NextResponse.json(
      { error: "Coin purchases have been removed. Melori is free." },
      { status: 410 }
        );
}
