import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyUnsubscribeToken } from "@/lib/notify-tokens";
import { isUuid } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET/POST /api/social/notifications/unsubscribe?u=<user id>&t=<signature>
//
// Turns off profiles.notifications_email for the signed member. Deliberately
// works with no session, because it is clicked from an email client.
//
// GET renders a confirmation page rather than unsubscribing immediately: mail
// clients and security scanners prefetch links, and a bare GET would silently
// opt people out who never clicked anything. POST performs the change, which
// is also what the List-Unsubscribe-Post one-click header targets.

function page(title: string, body: string, status = 200): NextResponse {
  return new NextResponse(
    `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Melori Music</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;background:#faf9fc;margin:0;padding:48px 20px;color:#1a1a1a;">
<div style="max-width:460px;margin:0 auto;background:#fff;border:1px solid #ececec;border-radius:16px;padding:28px;">
${body}
</div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

function invalid(): NextResponse {
  return page(
    "Link expired",
    `<h1 style="font-size:19px;margin:0 0 12px;">This unsubscribe link isn't valid</h1>
     <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 20px;">It may have expired. You can turn email notifications off directly in your account settings.</p>
     <a href="/settings" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 22px;border-radius:9999px;">Open settings</a>`,
    400,
  );
}

function params(req: NextRequest): { userId: string; token: string } | null {
  const url = new URL(req.url);
  const userId = url.searchParams.get("u") ?? "";
  const token = url.searchParams.get("t") ?? "";
  if (!userId || !token || !isUuid(userId)) return null;
  if (!verifyUnsubscribeToken(userId, token)) return null;
  return { userId, token };
}

export async function GET(req: NextRequest) {
  const p = params(req);
  if (!p) return invalid();
  const action = `/api/social/notifications/unsubscribe?u=${encodeURIComponent(p.userId)}&t=${encodeURIComponent(p.token)}`;
  return page(
    "Turn off email notifications",
    `<h1 style="font-size:19px;margin:0 0 12px;">Turn off Melori email notifications?</h1>
     <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 20px;">You'll stop receiving emails about new messages. Your messages themselves are unaffected — they'll still be waiting for you on the site.</p>
     <form method="post" action="${action}" style="margin:0;">
       <button type="submit" style="background:#7c3aed;color:#fff;border:0;font-weight:600;font-size:15px;padding:11px 22px;border-radius:9999px;cursor:pointer;">Turn them off</button>
     </form>
     <p style="font-size:13px;line-height:1.6;color:#888;margin:18px 0 0;">Changed your mind? <a href="/settings" style="color:#7c3aed;">Manage notifications in settings</a>.</p>`,
  );
}

export async function POST(req: NextRequest) {
  const p = params(req);
  if (!p) return invalid();

  const { error } = await getSupabaseAdmin()
    .from("profiles")
    .update({ notifications_email: false })
    .eq("id", p.userId);

  if (error) {
    console.error("unsubscribe update failed", error.message);
    return page(
      "Something went wrong",
      `<h1 style="font-size:19px;margin:0 0 12px;">We couldn't update that</h1>
       <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 20px;">Please try the toggle in your account settings instead.</p>
       <a href="/settings" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 22px;border-radius:9999px;">Open settings</a>`,
      500,
    );
  }

  return page(
    "Unsubscribed",
    `<h1 style="font-size:19px;margin:0 0 12px;">You're unsubscribed</h1>
     <p style="font-size:15px;line-height:1.6;color:#444;margin:0 0 20px;">We won't email you about new messages any more. You can turn this back on any time in your settings.</p>
     <a href="/settings" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:11px 22px;border-radius:9999px;">Open settings</a>`,
  );
}
