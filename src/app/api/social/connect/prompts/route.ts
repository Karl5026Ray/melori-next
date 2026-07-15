import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireAuth, isGuardFailure } from "@/lib/membership-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET  /api/social/connect/prompts — active prompt library.
// POST /api/social/connect/prompts — save up to 3 of MY prompt answers.
//   Body: { answers: [{ prompt_id, answer }] } — replaces the caller's set.

export async function GET(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from("dating_prompts")
    .select("id, text")
    .eq("is_active", true)
    .order("id", { ascending: true });
  return NextResponse.json({ prompts: data ?? [] });
}

export async function POST(req: NextRequest) {
  const guard = await requireAuth(req);
  if (isGuardFailure(guard)) return guard;
  const me = guard.membership.userId!;

  const body = (await req.json().catch(() => ({}))) as { answers?: unknown };
  const answersInput = Array.isArray(body.answers) ? body.answers : [];

  // App-layer cap: at most 3 prompt answers (schema allows more but the product
  // shows exactly three).
  const answers = answersInput
    .map((a) => a as { prompt_id?: unknown; answer?: unknown })
    .filter(
      (a) =>
        Number.isFinite(Number(a.prompt_id)) &&
        typeof a.answer === "string" &&
        a.answer.trim().length > 0,
    )
    .slice(0, 3)
    .map((a, i) => ({
      profile_id: me,
      prompt_id: Math.trunc(Number(a.prompt_id)),
      answer: String(a.answer).trim().slice(0, 500),
      sort_order: i,
    }));

  const supabase = getSupabaseAdmin();
  // Replace the caller's prompt set atomically-ish (delete then insert).
  const { error: delErr } = await supabase
    .from("dating_profile_prompts")
    .delete()
    .eq("profile_id", me);
  if (delErr) {
    return NextResponse.json({ error: delErr.message }, { status: 500 });
  }
  if (answers.length > 0) {
    const { error } = await supabase.from("dating_profile_prompts").insert(answers);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }
  return NextResponse.json({ ok: true, count: answers.length });
}
