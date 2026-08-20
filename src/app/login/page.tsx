import type { Metadata } from "next";
import AuthForm from "@/components/AuthForm";

// Standalone /login page. Previously /login only redirected to /social/auth;
// it now renders the real, canonical sign-in form (shared AuthForm) so the
// literal /login path is a genuine login page. ?next= and ?error= are honored
// by AuthForm via useSearchParams.
export const metadata: Metadata = {
  title: "Sign In",
  description: "Sign in to your Melori Music account.",
};

export default function LoginPage() {
  return (
    <div className="flex min-h-[70vh] flex-col">
      <AuthForm />
    </div>
  );
}
