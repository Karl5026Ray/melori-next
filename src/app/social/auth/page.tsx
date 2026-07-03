"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Music, Mail, Lock, User, ArrowRight } from "lucide-react";

export default function AuthPage() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"artist" | "superfan">("superfan");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      if (isSignUp) {
        const { error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              username,
              role,
              display_name: username,
            },
          },
        });
        if (signUpError) throw signUpError;
        router.push("/social/spaces");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        router.push("/social/spaces");
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-melori-purple to-melori-pink flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Music className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold mb-1">
            {isSignUp ? "Join Melori" : "Welcome Back"}
          </h1>
          <p className="text-melori-muted text-sm">
            The OS for independent music
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <>
              <div className="relative">
                <User className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-melori-muted" />
                <input
                  type="text"
                  required
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username"
                  className="w-full bg-melori-elevated border border-melori-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  onClick={() => setRole("artist")}
                  className={`p-3 rounded-xl border text-sm font-medium transition ${
                    role === "artist"
                      ? "border-melori-purple bg-melori-purple/10 text-melori-purple"
                      : "border-melori-border text-melori-muted hover:border-melori-purple/30"
                  }`}
                >
                  Artist
                </button>
                <button
                  type="button"
                  onClick={() => setRole("superfan")}
                  className={`p-3 rounded-xl border text-sm font-medium transition ${
                    role === "superfan"
                      ? "border-melori-purple bg-melori-purple/10 text-melori-purple"
                      : "border-melori-border text-melori-muted hover:border-melori-purple/30"
                  }`}
                >
                  Superfan
                </button>
              </div>
            </>
          )}

          <div className="relative">
            <Mail className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-melori-muted" />
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email"
              className="w-full bg-melori-elevated border border-melori-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition"
            />
          </div>

          <div className="relative">
            <Lock className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-melori-muted" />
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full bg-melori-elevated border border-melori-border rounded-xl pl-10 pr-4 py-3 text-sm focus:outline-none focus:border-melori-purple transition"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 p-3 rounded-xl">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full py-3.5 rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {loading ? "Please wait..." : isSignUp ? "Create Account" : "Sign In"}
            <ArrowRight className="w-4 h-4" />
          </button>
        </form>

        <p className="text-center text-sm text-melori-muted mt-6">
          {isSignUp ? "Already have an account?" : "Don't have an account?"}{" "}
          <button
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-melori-purple hover:underline font-medium"
          >
            {isSignUp ? "Sign In" : "Sign Up"}
          </button>
        </p>
      </div>
    </div>
  );
}
