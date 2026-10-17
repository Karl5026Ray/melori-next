import { NextResponse, type NextRequest } from "next/server";
import { appLinkTarget } from "@/lib/appLinks";

// GET /app — the one link printed on flyers and QR codes. iPhone → App Store,
// Android → Play (or the beta signup until Play is public), anything else →
// the site. See src/lib/appLinks.ts. Public: listed in PUBLIC_EXACT
// (src/proxy.ts), or a stranger scanning a flyer would meet the signup door.
export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const res = NextResponse.redirect(
    new URL(appLinkTarget(req.headers.get("user-agent")), req.url),
    302,
  );
  // The answer depends on the phone, so no shared cache may keep it.
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("Vary", "User-Agent");
  return res;
}
