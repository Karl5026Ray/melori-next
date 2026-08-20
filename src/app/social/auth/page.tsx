import AuthForm from "@/components/AuthForm";

// Supabase login gateway. Uses the shared AuthForm so /social/auth and the
// top-level /login route render an identical, canonical sign-in surface
// (Google + Apple OAuth, email/password, forgot-password, sign-up link).
export default function AuthPage() {
  return <AuthForm />;
}
