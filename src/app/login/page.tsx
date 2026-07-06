import { redirect } from "next/navigation";

// /login is an alias for the Supabase login gateway at /social/auth.
export default function LoginPage({
  searchParams,
}: {
  searchParams?: { next?: string };
}) {
  const next = searchParams?.next;
  const suffix =
    next && next.startsWith("/") && !next.startsWith("//")
      ? `?next=${encodeURIComponent(next)}`
      : "";
  redirect(`/social/auth${suffix}`);
}
