import { NextRequest, NextResponse } from "next/server";
import { requireArtist, isGuardFailure } from "@/lib/membership-server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isAdmin } from "@/lib/membership";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTRACTS_BUCKET = "photo-contracts";
const SIGNED_URL_TTL_SECONDS = 60 * 5;

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

// POST /api/studio/services/[id]/contract — owner/admin only. Multipart PDF
// upload, stored in the private photo-contracts bucket at
// `${photographerId}/${serviceId}/contract.pdf`. Saves the storage key (not a
// public URL, since the bucket is private) to contract_url.
export async function POST(
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

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { error: "Expected multipart/form-data" },
      { status: 400 },
    );
  }

  const file = form.get("file");
  if (!file || typeof file !== "object" || !("arrayBuffer" in file)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }
  const uploadFile = file as File;
  const isPdf =
    uploadFile.type === "application/pdf" ||
    uploadFile.name?.toLowerCase().endsWith(".pdf");
  if (!isPdf) {
    return NextResponse.json(
      { error: "Contract must be a PDF file" },
      { status: 400 },
    );
  }

  const photographerId = service.photographer_id as string;
  const storageKey = `${photographerId}/${serviceId}/contract.pdf`;
  const buffer = Buffer.from(await uploadFile.arrayBuffer());

  const { error: upErr } = await supabase.storage
    .from(CONTRACTS_BUCKET)
    .upload(storageKey, buffer, {
      contentType: "application/pdf",
      upsert: true,
    });
  if (upErr) {
    console.error("studio/services contract upload failed", upErr.message);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { data: updated, error } = await supabase
    .from("photo_services")
    .update({ contract_url: storageKey, updated_at: new Date().toISOString() })
    .eq("id", serviceId)
    .select("id, contract_url")
    .single();

  if (error || !updated) {
    console.error("studio/services contract row update failed", error?.message);
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, hasContract: true });
}

// GET /api/studio/services/[id]/contract — owner/admin only. Returns a
// short-lived signed URL to download the stored contract PDF.
export async function GET(
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
  if (!service.contract_url) {
    return NextResponse.json({ error: "No contract uploaded" }, { status: 404 });
  }

  const { data: signed, error } = await supabase.storage
    .from(CONTRACTS_BUCKET)
    .createSignedUrl(service.contract_url as string, SIGNED_URL_TTL_SECONDS);

  if (error || !signed) {
    console.error("studio/services contract sign failed", error?.message);
    return NextResponse.json(
      { error: "Could not create download link" },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: signed.signedUrl });
}
