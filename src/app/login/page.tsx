import { redirect } from "next/navigation";

// /login is an alias for the Supabase login gateway at /social/auth.
export default async function LoginPage(
  props: {
    searchParams?: Promise<{ next?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const next = searchParams?.next;
  const suffix =
    next && next.startsWith("/") && !next.startsWith("//")
      ? `?next=${encodeURIComponent(next)}`
      : "";
  redirect(`/social/auth${suffix}`);
}
