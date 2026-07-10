import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getAdminSecretKey } from "@/lib/admin-secret";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function requireAdmin(req: NextRequest) {
const auth = req.headers.get("authorization") || "";
const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;
if (!token) return null;
try {
const secret = getAdminSecretKey();
if (!secret) return null;
const { payload } = await jwtVerify(token, secret);
if (payload.role !== "admin") return null;
return payload;
} catch {
return null;
}
}

export async function DELETE(
req: NextRequest,
{ params }: { params: { id: string } }
) {
const admin = await requireAdmin(req);
if (!admin) {
return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
const id = params.id;
if (!id) {
return NextResponse.json({ error: "Missing space id" }, { status: 400 });
}
const supabase = getSupabaseAdmin();
const { error } = await supabase.from("spaces").delete().eq("id", id);
if (error) {
return NextResponse.json({ error: error.message }, { status: 500 });
}
return NextResponse.json({ ok: true });
}

export async function PATCH(
req: NextRequest,
{ params }: { params: { id: string } }
) {
const admin = await requireAdmin(req);
if (!admin) {
return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
const id = params.id;
if (!id) {
return NextResponse.json({ error: "Missing space id" }, { status: 400 });
}
let body: Record<string, unknown>;
try {
body = await req.json();
} catch {
return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
}
const updates: Record<string, unknown> = {};
if (typeof body.name === "string") updates.name = body.name;
if (typeof body.status === "string") updates.status = body.status;
if (Object.keys(updates).length === 0) {
return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
}
const supabase = getSupabaseAdmin();
const { data, error } = await supabase
.from("spaces")
.update(updates)
.eq("id", id)
.select()
.single();
if (error) {
return NextResponse.json({ error: error.message }, { status: 500 });
}
return NextResponse.json({ ok: true, space: data });
}
