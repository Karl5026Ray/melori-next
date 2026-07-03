import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const supabase = createServiceClient();
    const { filename, type } = await req.json();

    const bucket = type === "cover" ? "covers" : "music";
    const path = `${Date.now()}_${filename.replace(/\s+/g, "_")}`;

    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 600); // 10 min expiry

    if (error || !data?.signedUrl) {
      console.error("Signed URL error:", error);
      return NextResponse.json(
        { error: "Failed to create upload URL" },
        { status: 500 }
      );
    }

    const { data: publicData } = supabase.storage
      .from(bucket)
      .getPublicUrl(path);

    return NextResponse.json({
      signedUrl: data.signedUrl,
      publicUrl: publicData.publicUrl,
      path,
    });
  } catch (err: any) {
    console.error("Upload URL error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
