import { NextRequest, NextResponse } from "next/server";
import { RtcTokenBuilder, RtcRole } from "agora-token";

const APP_ID = process.env.NEXT_PUBLIC_AGORA_APP_ID ?? "";
const APP_CERTIFICATE = process.env.AGORA_APP_CERTIFICATE ?? "";

export async function POST(req: NextRequest) {
  try {
    if (!APP_ID || !APP_CERTIFICATE) {
      return NextResponse.json(
        { error: "Agora is not configured" },
        { status: 503 }
      );
    }

    const {
      channel,
      uid = 0,
      role = "publisher",
      expireTime = 3600,
    } = await req.json();

    if (!channel) {
      return NextResponse.json(
        { error: "Channel name required" },
        { status: 400 }
      );
    }

    // agora-token expects durations (seconds from now) for both the token
    // lifetime and the privilege lifetime.
    const token = RtcTokenBuilder.buildTokenWithUid(
      APP_ID,
      APP_CERTIFICATE,
      channel,
      uid,
      role === "publisher" ? RtcRole.PUBLISHER : RtcRole.SUBSCRIBER,
      expireTime,
      expireTime
    );

    return NextResponse.json({ token, uid, channel, expiresIn: expireTime });
  } catch (error) {
    console.error("Agora token error:", error);
    return NextResponse.json(
      { error: "Token generation failed" },
      { status: 500 }
    );
  }
}
