import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTRACTS_BUCKET = "photo-contracts";

async function loadOwnedService(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  serviceId: string,
  userId: string,
  callerIsAdmin: boolean,
) {
  const { data: service, error } = await supabase
    .from("photo_services")
    .select("id, photographer_id, contract_url")
    .eq("id", serviceId)
    .maybeSingle();
  if (error || !service) return { service: null, forbidden: false };
  if (service.photographer_id !== userId && !callerIsAdmin) {
    return { service: null, forbidden: true };
  }
  return { service, forbidden: false };
}

// PATCH /api/studio/services/[id] — owner/admin only. Updates any subset of
// service fields.
export async function PATCH(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  const { id: serviceId } = await props.params;
  const supabase = getSupabaseAdmin();

  const { service, forbidden } = await loadOwnedService(
    supabase,
    serviceId,
    userId,
    callerIsAdmin,
  );
  if (forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  let body: {
    name?: string;
    description?: string | null;
    durationMinutes?: number;
    priceCents?: number;
    depositCents?: number;
    depositPercent?: number | null;
    isActive?: boolean;
    sortOrder?: number;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (typeof body.name === "string" && body.name.trim()) {
    update.name = body.name.trim();
  }
  if (body.description !== undefined) {
    update.description =
      typeof body.description === "string" && body.description.trim()
        ? body.description.trim()
        : null;
  }
  if (Number.isInteger(body.durationMinutes) && (body.durationMinutes as number) > 0) {
    update.duration_minutes = body.durationMinutes;
  }
  if (Number.isInteger(body.priceCents) && (body.priceCents as number) >= 0) {
    update.price_cents = body.priceCents;
  }
  if (Number.isInteger(body.depositCents) && (body.depositCents as number) >= 0) {
    update.deposit_cents = body.depositCents;
  }
  if (body.depositPercent !== undefined) {
    update.deposit_percent =
      Number.isInteger(body.depositPercent) &&
      (body.depositPercent as number) >= 0 &&
      (body.depositPercent as number) <= 100
        ? body.depositPercent
        : null;
  }
  if (typeof body.isActive === "boolean") {
    update.is_active = body.isActive;
  }
  if (Number.isInteger(body.sortOrder)) {
    update.sort_order = body.sortOrder;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No changes provided" }, { status: 400 });
  }
  update.updated_at = new Date().toISOString();

  const { data: updated, error } = await supabase
    .from("photo_services")
    .update(update)
    .eq("id", serviceId)
    .select(
      "id, name, description, duration_minutes, price_cents, deposit_cents, deposit_percent, is_active, sort_order, contract_url, created_at, updated_at",
    )
    .single();

  if (error || !updated) {
    console.error("studio/services/[id] PATCH failed", error?.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({
    service: { ...updated, hasContract: Boolean(updated.contract_url) },
  });
}

// DELETE /api/studio/services/[id] — owner/admin only. Deletes the row and
// best-effort removes any uploaded contract PDF from storage.
export async function DELETE(
  req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const guard = await requireArtist(req);
  if (isGuardFailure(guard)) return guard;
  const userId = guard.membership.userId as string;
  const callerIsAdmin = isAdmin(guard.membership.profile);

  const { id: serviceId } = await props.params;
  const supabase = getSupabaseAdmin();

  const { service, forbidden } = await loadOwnedService(
    supabase,
    serviceId,
    userId,
    callerIsAdmin,
  );
  if (forbidden) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  if (!service) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }

  if (service.contract_url) {
    await supabase.storage
      .from(CONTRACTS_BUCKET)
      .remove([service.contract_url as string])
      .catch(() => {});
  }

  const { error } = await supabase
    .from("photo_services")
    .delete()
    .eq("id", serviceId);

  if (error) {
    console.error("studio/services/[id] DELETE failed", error.message);
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
