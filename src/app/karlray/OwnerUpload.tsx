"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import UploadPanel from "@/app/studio/galleries/UploadPanel";

// "Add photos" straight from the profile, shown only to the gallery's owner
// (Karl, 2026-10-17: "find an easier way for me to upload new pictures").
// One tap opens the phone's photo picker; pick as many as you like and they
// go into the portfolio gallery. Ownership is enforced server-side by the
// signed-url and finalize routes — hiding the button is only convenience.
export default function OwnerUpload({
  ownerId,
  galleryId,
}: {
  ownerId: string;
  galleryId: string;
}) {
  const router = useRouter();
  const [isOwner, setIsOwner] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (alive) setIsOwner(data.session?.user.id === ownerId);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [ownerId]);

  if (!isOwner) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 rounded-full bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary-dark"
      >
        <Plus className="h-4 w-4" /> Add photos
      </button>
    );
  }

  return (
    <div className="mt-4">
      <UploadPanel
        galleryId={galleryId}
        onUploaded={() => router.refresh()}
        onDone={() => {
          setOpen(false);
          router.refresh();
        }}
      />
      <p className="mt-2 text-xs text-text-secondary">
        New photos show on your page within a minute.
      </p>
    </div>
  );
}
