import { NextResponse } from "next/server";

// Music purchases were removed from Melori entirely — all catalog content is
// free for every member, and there is no payment mechanism left on the
// platform. This endpoint is kept only so old clients get a clean, explicit
// response instead of a 404.
export async function POST() {
    return NextResponse.json(
      { error: "Music purchases have been removed. All music on Melori is free." },
      { status: 410 }
        );
}
