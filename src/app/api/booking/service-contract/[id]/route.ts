import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CONTRACTS_BUCKET = "photo-contracts";
const SIGNED_URL_TTL_SECONDS = 60 * 10;

// GET /api/booking/service-contract/[id] — PUBLIC, no auth. Returns a
// short-lived signed URL to the contract PDF for an ACTIVE service so a
// prospective client can review the terms before booking/paying. Deliberately
// narrow: only active services, only the contract file, no other fields. The
// studio-side upload/manage endpoints stay owner/admin-gated as before.
export async function GET(
  _req: NextRequest,
  props: { params: Promise<{ id: string }> },
) {
  const { id: serviceId } = await props.params;
  if (!serviceId) {
    return NextResponse.json({ error: "Service id required" }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();
  const { data: service, error } = await supabase
    .from("photo_services")
    .select("id, is_active, contract_url")
    .eq("id", serviceId)
    .maybeSingle();

  if (error || !service || !service.is_active) {
    return NextResponse.json({ error: "Service not found" }, { status: 404 });
  }
  if (!service.contract_url) {
    return NextResponse.json({ error: "No contract available" }, { status: 404 });
  }

  const { data: signed, error: signErr } = await supabase.storage
    .from(CONTRACTS_BUCKET)
    .createSignedUrl(service.contract_url as string, SIGNED_URL_TTL_SECONDS);

  if (signErr || !signed) {
    console.error("booking/service-contract sign failed", signErr?.message);
    return NextResponse.json(
      { error: "Could not create contract link" },
      { status: 500 },
    );
  }

  return NextResponse.json({ url: signed.signedUrl });
}
