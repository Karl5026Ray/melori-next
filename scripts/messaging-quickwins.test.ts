/* eslint-disable no-console */
// scripts/messaging-quickwins.test.ts
//
// Pins the Messages quick wins (migration 092): photos, emoji, Seen, multi-line
// input, reactions, no alert(). Mostly WIRING assertions (tasks/lessons.md:
// "When a fix is wiring, assert on the wiring").
//
// Run:  npx tsx scripts/messaging-quickwins.test.ts

import { readFileSync } from "node:fs";
import { previewText, REACTION_EMOJI, validateAttachments } from "@/lib/messageMedia";

let checks = 0;
let failures = 0;
function expect(label: string, actual: unknown, wanted: unknown) {
  checks += 1;
  if (actual === wanted) console.log(`  ok    ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${label} — got ${String(actual)}, wanted ${String(wanted)}`);
  }
}
const has = (file: string, needle: string, label: string) =>
  expect(label, readFileSync(file, "utf8").includes(needle), true);

const C = "11111111-1111-4111-8111-111111111111";
const ME = "22222222-2222-4222-8222-222222222222";
const OTHER = "33333333-3333-4333-8333-333333333333";
const F = "44444444-4444-4444-8444-444444444444";
const ok = (p: string) => ({ type: "image", path: p, width: 800, height: 600 });

// ---- attachment validation -------------------------------------------------
expect("no attachments → []", JSON.stringify(validateAttachments(undefined, C, ME)), "[]");
expect("own file in this chat → accepted", Array.isArray(validateAttachments([ok(`${C}/${ME}/${F}.jpg`)], C, ME)), true);
expect("someone else's folder → rejected", typeof validateAttachments([ok(`${C}/${OTHER}/${F}.jpg`)], C, ME), "string");
expect("other conversation → rejected", typeof validateAttachments([ok(`${OTHER}/${ME}/${F}.jpg`)], C, ME), "string");
expect("path traversal → rejected", typeof validateAttachments([ok(`${C}/${ME}/../${F}.jpg`)], C, ME), "string");
expect("non-image ext → rejected", typeof validateAttachments([ok(`${C}/${ME}/${F}.svg`)], C, ME), "string");
expect("5 photos → rejected", typeof validateAttachments(Array(5).fill(ok(`${C}/${ME}/${F}.jpg`)), C, ME), "string");
expect("photo-only preview", previewText(""), "📷 Photo");
expect("text preview unchanged", previewText("hey"), "hey");
expect("double-tap reaction is ❤️", REACTION_EMOJI[0], "❤️");

// ---- wiring ----------------------------------------------------------------
const PAGE = "src/app/social/messages/[conversationId]/page.tsx";
has(PAGE, "<textarea", "composer is a multi-line textarea");
has(PAGE, '!e.shiftKey', "Enter sends, Shift+Enter is a newline");
has(PAGE, "<EmojiPicker", "emoji button opens the picker");
has(PAGE, "uploadToSignedUrl", "photos upload to a signed URL");
has(PAGE, "/api/social/messages/upload-url", "thread asks the server for the upload URL");
has(PAGE, "onReact={toggleReaction}", "bubbles get the reaction handler");
has(PAGE, "seen={msg.id === lastSeenMineId}", "Seen is wired to the bubble");
has(PAGE, '"read"', "read receipts broadcast live");
has("src/app/api/social/messages/route.ts", "validateAttachments(", "send route validates attachments");
has("src/app/api/social/messages/route.ts", "moderateImage(", "send route screens photos");
has("src/app/api/social/messages/[id]/route.ts", "attachments: []", "delete clears photos");
has("src/app/api/social/conversations/[id]/route.ts", "other_last_read_at", "thread API returns the other read time");
has("src/app/api/cron/dm-email-notifications/route.ts", "previewText(", "email preview handles photo-only");
expect(
  "NewMessageModal no longer uses alert()",
  readFileSync("src/components/social/messages/NewMessageModal.tsx", "utf8").includes("alert("),
  false,
);
has(PAGE, "profiles!messages_sender_id_fkey", "sender embed names its FK (no PGRST201 ambiguity)");
expect("thread never scrolls the window", /\.scrollIntoView\(/.test(readFileSync(PAGE, "utf8")), false);
has(PAGE, "100dvh-4rem-var(--mobile-tabbar-clearance)", "thread is pinned to the visible screen on phones");
expect("composer has no leftover tab-bar margin", readFileSync(PAGE, "utf8").includes("mb-28"), false);
has(PAGE, 'behavior: firstLoad ? "auto" : "smooth"', "a thread opens at the newest message");
has(PAGE, "prefetchIceServers(", "thread fetches TURN relay credentials");
has("src/lib/callClient.ts", "...relayServers", "peer connections use the relay servers");
has("src/app/api/social/calls/ice/route.ts", "requireAuth(", "relay credentials require sign-in");
expect(
  "093 moves reactions.user_id off profiles",
  readFileSync("supabase/migrations/093_message_reactions_user_fk_auth.sql", "utf8").includes("references auth.users(id)"),
  true,
);
const SQL = readFileSync("supabase/migrations/092_messages_photos_reactions.sql", "utf8");
expect("092 makes the bucket private", /'message-media',\s*'message-media',\s*false/.test(SQL), true);
expect("092 keeps reactions out of postgres_changes", SQL.includes("alter publication"), false);
expect("092 has no DROP statements", /\bdrop\b/i.test(SQL.replace(/--.*$/gm, "")), false);

console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
if (failures) process.exit(1);
