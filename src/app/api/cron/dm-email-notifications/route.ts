import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendDmDigestEmail, type DmDigestThread } from "@/lib/email";
import { unsubscribeUrl } from "@/lib/notify-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SITE_ORIGIN = "https://melorimusic.org";

// A message has to sit unread this long before it earns an email. This is the
// whole reason the notifier is a cron and not a hook on the send path: during a
// live back-and-forth both people are already looking at the thread, and
// emailing per message would be pure spam. Ten minutes of silence means the
// recipient genuinely isn't there.
const QUIET_PERIOD_MS = 10 * 60 * 1000;

// Anything older than this gets stamped and skipped rather than emailed. If the
// cron was broken for two days, nobody wants the backlog dumped on them.
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

// Cap per run. At current volume this is never hit; it bounds a cold start after
// an outage.
const MAX_MESSAGES = 500;

const PREVIEW_CHARS = 140;

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  created_at: string;
};

type MemberRow = {
  conversation_id: string;
  user_id: string;
  last_read_at: string | null;
};

type ConversationRow = {
  id: string;
  status: string;
  requested_by: string | null;
  created_at: string;
  request_email_sent_at: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string | null;
  username: string | null;
  notifications_email: boolean | null;
  status: string | null;
  deleted_at: string | null;
};

// Accumulates everything waiting for one recipient across all their threads.
type Pending = {
  // conversation id -> thread summary being built
  threads: Map<
    string,
    {
      senderId: string;
      count: number;
      latestAt: number;
      preview: string;
      isRequest: boolean;
    }
  >;
  // Message rows contributing to this recipient, so a failed send can leave
  // exactly those rows unstamped for the next run.
  messageIds: Set<string>;
  // Conversations whose request stamp should be set once this send succeeds.
  requestConvIds: Set<string>;
};

function truncate(s: string): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length > PREVIEW_CHARS
    ? `${clean.slice(0, PREVIEW_CHARS - 1)}…`
    : clean;
}

function nameOf(p: ProfileRow | undefined): string {
  return p?.display_name?.trim() || p?.username?.trim() || "A Melori member";
}

// GET/POST /api/cron/dm-email-notifications
//
// Emails members about direct messages they haven't read. Runs every 15 minutes
// (see vercel.json) and batches: one email per member per run, covering every
// thread with something waiting, rather than one email per message.
//
// Deliberately reads from the messages table instead of hooking the send path.
// The send path is /api/social/messages and it was left completely untouched —
// messaging had just been implicated in a production sign-in outage when this
// was written, so the notifier is strictly additive and cannot regress it.
//
// Idempotency: every message considered is stamped with email_notified_at, and
// every pending request emailed about is stamped with request_email_sent_at.
// Rows belonging to a recipient whose send threw are left unstamped so the next
// run retries them. Overlapping runs can at worst re-send one batch, never loop.
//
// Auth mirrors the other crons: shared CRON_SECRET via x-cron-secret or
// Authorization: Bearer. We never trust x-vercel-cron alone.
async function handle(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }
  const provided =
    req.headers.get("x-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (provided !== secret) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const supabase = getSupabaseAdmin();
  const now = Date.now();
  const cutoff = new Date(now - QUIET_PERIOD_MS).toISOString();

  // --- 1. Messages nobody has been told about yet -------------------------
  const { data: msgs, error: msgErr } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, content, created_at")
    .is("email_notified_at", null)
    .is("deleted_at", null)
    .eq("moderation_status", "clean")
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(MAX_MESSAGES);
  if (msgErr) {
    console.error("dm-email-notifications: message query failed", msgErr.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
  const messages = (msgs ?? []) as MessageRow[];

  // --- 2. Pending requests, including ones carrying no messages at all ----
  // A first-contact request can exist with zero message rows, so it would never
  // show up in the query above. Those are exactly the ones that go unanswered.
  const { data: reqs, error: reqErr } = await supabase
    .from("conversations")
    .select("id, status, requested_by, created_at, request_email_sent_at")
    .eq("status", "pending")
    .is("request_email_sent_at", null)
    .lte("created_at", cutoff);
  if (reqErr) {
    console.error("dm-email-notifications: request query failed", reqErr.message);
    return NextResponse.json({ error: "query failed" }, { status: 500 });
  }
  const pendingRequests = (reqs ?? []) as ConversationRow[];

  if (!messages.length && !pendingRequests.length) {
    return NextResponse.json({ ok: true, considered: 0, emailed: 0 });
  }

  // --- 3. Load the conversations and their members ------------------------
  const convIds = Array.from(
    new Set([
      ...messages.map((m) => m.conversation_id),
      ...pendingRequests.map((c) => c.id),
    ]),
  );

  const { data: convRows } = await supabase
    .from("conversations")
    .select("id, status, requested_by, created_at, request_email_sent_at")
    .in("id", convIds);
  const convById = new Map<string, ConversationRow>(
    ((convRows ?? []) as ConversationRow[]).map((c) => [c.id, c]),
  );

  const { data: memberRows } = await supabase
    .from("conversation_members")
    .select("conversation_id, user_id, last_read_at")
    .in("conversation_id", convIds);
  const membersByConv = new Map<string, MemberRow[]>();
  for (const m of (memberRows ?? []) as MemberRow[]) {
    const list = membersByConv.get(m.conversation_id) ?? [];
    list.push(m);
    membersByConv.set(m.conversation_id, list);
  }

  // --- 4. Fold messages into per-recipient buckets ------------------------
  const pending = new Map<string, Pending>();
  const bucket = (userId: string): Pending => {
    let p = pending.get(userId);
    if (!p) {
      p = { threads: new Map(), messageIds: new Set(), requestConvIds: new Set() };
      pending.set(userId, p);
    }
    return p;
  };

  const allMessageIds = new Set(messages.map((m) => m.id));
  const stampRequestIds = new Set<string>();

  for (const msg of messages) {
    const conv = convById.get(msg.conversation_id);
    const isRequest = conv?.status === "pending";
    const sentAt = new Date(msg.created_at).getTime();
    // Too old to be worth an email, but still gets stamped below.
    if (now - sentAt > MAX_AGE_MS) continue;

    for (const member of membersByConv.get(msg.conversation_id) ?? []) {
      if (member.user_id === msg.sender_id) continue;
      // Already read it in-app — the badge did its job, no email needed.
      const lastRead = member.last_read_at
        ? new Date(member.last_read_at).getTime()
        : 0;
      if (lastRead >= sentAt) continue;

      const p = bucket(member.user_id);
      p.messageIds.add(msg.id);
      const existing = p.threads.get(msg.conversation_id);
      if (existing) {
        existing.count += 1;
        if (sentAt >= existing.latestAt) {
          existing.latestAt = sentAt;
          existing.preview = truncate(msg.content);
        }
      } else {
        p.threads.set(msg.conversation_id, {
          senderId: msg.sender_id,
          count: 1,
          latestAt: sentAt,
          preview: truncate(msg.content),
          isRequest,
        });
      }
      if (isRequest) p.requestConvIds.add(msg.conversation_id);
    }
  }

  // Requests with no message rows: notify the person who did not open it.
  for (const conv of pendingRequests) {
    if (now - new Date(conv.created_at).getTime() > MAX_AGE_MS) {
      stampRequestIds.add(conv.id);
      continue;
    }
    const members = membersByConv.get(conv.id) ?? [];
    for (const member of members) {
      if (member.user_id === conv.requested_by) continue;
      const p = bucket(member.user_id);
      if (p.threads.has(conv.id)) {
        p.requestConvIds.add(conv.id);
        continue;
      }
      const other = members.find((m) => m.user_id !== member.user_id);
      p.threads.set(conv.id, {
        senderId: conv.requested_by ?? other?.user_id ?? "",
        count: 1,
        latestAt: new Date(conv.created_at).getTime(),
        preview: "",
        isRequest: true,
      });
      p.requestConvIds.add(conv.id);
    }
  }

  // --- 5. Resolve profiles, opt-outs and blocks ---------------------------
  const senderIds = new Set<string>();
  for (const p of pending.values()) {
    for (const t of p.threads.values()) if (t.senderId) senderIds.add(t.senderId);
  }
  const profileIds = Array.from(new Set([...pending.keys(), ...senderIds]));

  const { data: profileRows } = await supabase
    .from("profiles")
    .select("id, display_name, username, notifications_email, status, deleted_at")
    .in("id", profileIds);
  const profileById = new Map<string, ProfileRow>(
    ((profileRows ?? []) as ProfileRow[]).map((p) => [p.id, p]),
  );

  const { data: blockRows } = await supabase
    .from("member_blocks")
    .select("blocker_id, blocked_id")
    .or(
      `blocker_id.in.(${profileIds.join(",")}),blocked_id.in.(${profileIds.join(",")})`,
    );
  const blocked = new Set(
    ((blockRows ?? []) as { blocker_id: string; blocked_id: string }[]).flatMap(
      (b) => [`${b.blocker_id}:${b.blocked_id}`, `${b.blocked_id}:${b.blocker_id}`],
    ),
  );

  // --- 6. Send ------------------------------------------------------------
  const failedMessageIds = new Set<string>();
  let emailed = 0;
  let skipped = 0;

  for (const [recipientId, p] of pending) {
    const profile = profileById.get(recipientId);
    // Opted out, suspended, or deleted.
    if (
      !profile ||
      profile.notifications_email === false ||
      profile.deleted_at ||
      (profile.status && profile.status !== "active")
    ) {
      skipped += 1;
      continue;
    }

    const threads: DmDigestThread[] = [];
    for (const [convId, t] of p.threads) {
      if (blocked.has(`${recipientId}:${t.senderId}`)) continue;
      threads.push({
        from: nameOf(profileById.get(t.senderId)),
        count: t.count,
        preview: t.preview,
        isRequest: t.isRequest,
        href: t.isRequest
          ? `${SITE_ORIGIN}/social/messages`
          : `${SITE_ORIGIN}/social/messages/${convId}`,
      });
    }
    if (!threads.length) {
      skipped += 1;
      continue;
    }
    threads.sort((a, b) => Number(b.isRequest) - Number(a.isRequest));

    // profiles carries no email address; it lives on the auth user.
    const { data: authUser, error: authErr } =
      await supabase.auth.admin.getUserById(recipientId);
    const to = authUser?.user?.email;
    if (authErr || !to) {
      skipped += 1;
      continue;
    }

    try {
      await sendDmDigestEmail({
        to,
        greetingName: nameOf(profile).split(" ")[0] ?? "there",
        threads,
        inboxUrl: `${SITE_ORIGIN}/social/messages`,
        unsubscribeUrl: unsubscribeUrl(SITE_ORIGIN, recipientId),
      });
      emailed += 1;
      for (const id of p.requestConvIds) stampRequestIds.add(id);
    } catch (e) {
      console.error(
        "dm-email-notifications: send failed",
        recipientId,
        e instanceof Error ? e.message : e,
      );
      // Leave this recipient's rows for the next run.
      for (const id of p.messageIds) failedMessageIds.add(id);
    }

    // Resend's default rate limit is 2 requests/second.
    await new Promise((r) => setTimeout(r, 600));
  }

  // --- 7. Stamp -----------------------------------------------------------
  const toStamp = [...allMessageIds].filter((id) => !failedMessageIds.has(id));
  if (toStamp.length) {
    const { error } = await supabase
      .from("messages")
      .update({ email_notified_at: new Date().toISOString() })
      .in("id", toStamp);
    if (error) {
      console.error("dm-email-notifications: stamp failed", error.message);
    }
  }
  if (stampRequestIds.size) {
    const { error } = await supabase
      .from("conversations")
      .update({ request_email_sent_at: new Date().toISOString() })
      .in("id", [...stampRequestIds]);
    if (error) {
      console.error("dm-email-notifications: request stamp failed", error.message);
    }
  }

  return NextResponse.json({
    ok: true,
    considered: messages.length,
    requests: pendingRequests.length,
    recipients: pending.size,
    emailed,
    skipped,
    retrying: failedMessageIds.size,
  });
}

export const GET = handle;
export const POST = handle;
