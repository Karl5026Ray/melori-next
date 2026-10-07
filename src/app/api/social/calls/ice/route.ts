import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";
import { rateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/social/calls/ice
// Short-lived TURN relay credentials for DM voice/video calls.
//
// Calls are peer-to-peer WebRTC. Two phones can only reach each other directly
// when their networks allow it; on cellular data and most home routers they
// don't, and the call rings but never connects. A TURN relay fixes that. We
// use Cloudflare Realtime TURN: create a TURN key in the Cloudflare dashboard
// (Realtime → TURN Server) and set, in Vercel:
//   CLOUDFLARE_TURN_KEY_ID         – the key's id
//   CLOUDFLARE_TURN_KEY_API_TOKEN  – the key's API token
// Credentials are minted per request (24h TTL) so no long-lived secret ever
// reaches the browser. Without the env vars this returns [] and calls fall
// back to direct connections only.
const TTL_SECONDS = 24 * 60 * 60;

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const rl = rateLimit(`social:call-ice:${me}`, 20, 0.2);
  if (!rl.allowed) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const token = process.env.CLOUDFLARE_TURN_KEY_API_TOKEN?.trim();
  // A TURN key id is 32 hex chars and its token is a single word. Anything
  // else (a pasted curl command, an account API token, stray spaces) is a
  // setup mistake: say so plainly instead of sending it to Cloudflare.
  if (keyId && token && (!/^[0-9a-f]{32}$/i.test(keyId) || /\s/.test(token))) {
    console.error("[calls/ice] CLOUDFLARE_TURN_KEY_ID / _API_TOKEN look malformed — re-paste them from Cloudflare → Realtime → TURN Server");
    return NextResponse.json({ iceServers: [], relay: false });
  }
  if (!keyId || !token) {
    return NextResponse.json({ iceServers: [], relay: false });
  }

  try {
    const res = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ttl: TTL_SECONDS }),
        cache: "no-store",
        signal: AbortSignal.timeout(5000),
      },
    );
    if (!res.ok) {
      console.error("[calls/ice] Cloudflare TURN error", res.status, await res.text().catch(() => ""));
      return NextResponse.json({ iceServers: [], relay: false });
    }
    const j = (await res.json()) as { iceServers?: unknown };
    const list = Array.isArray(j.iceServers) ? j.iceServers : j.iceServers ? [j.iceServers] : [];
    return NextResponse.json(
      { iceServers: list, relay: list.length > 0 },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (err) {
    // Log the error TYPE only. Some fetch errors echo request headers, and the
    // Authorization header carries the TURN API token.
    console.error("[calls/ice] TURN request failed:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ iceServers: [], relay: false });
  }
}
