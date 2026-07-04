"use client";
import { useState } from "react";

// "Help us improve" feedback form for the About page. Open to any visitor
// (no auth). Posts to /api/feedback which validates the email and applies
// anti-spam checks before inserting into Supabase. Includes a hidden honeypot.
export default function HelpUsImprove() {
const [name, setName] = useState("");
const [email, setEmail] = useState("");
const [comment, setComment] = useState("");
const [company, setCompany] = useState(""); // honeypot
const [status, setStatus] = useState<"idle" | "submitting" | "done">("idle");
const [error, setError] = useState("");

const EMAIL_RE = /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/;

const handleSubmit = async (e: React.FormEvent) => {
e.preventDefault();
setError("");
if (!name.trim()) {
setError("Please enter your name.");
return;
}
if (!EMAIL_RE.test(email.trim())) {
setError("Please enter a valid email address.");
return;
}
if (comment.trim().length < 5) {
setError("Please add a comment (at least a few words).");
return;
}
setStatus("submitting");
try {
const res = await fetch("/api/feedback", {
method: "POST",
headers: { "Content-Type": "application/json" },
body: JSON.stringify({ name, email, comment, company }),
});
if (res.ok) {
setStatus("done");
setName("");
setEmail("");
setComment("");
return;
}
const data = await res.json().catch(() => ({}));
setError(data?.error ?? "Something went wrong. Please try again.");
setStatus("idle");
} catch {
setError("Something went wrong. Please try again.");
setStatus("idle");
}
};

if (status === "done") {
return (
<div className="rounded-2xl border border-brand-primary/40 bg-brand-primary/10 p-8 text-center">
<h3 className="text-xl font-bold">Thank you! 🙌</h3>
<p className="mt-2 text-text-secondary">Your feedback helps us make Melori better.</p>
<button type="button" onClick={() => setStatus("idle")} className="mt-4 text-sm font-semibold text-brand-primary hover:underline">Send another</button>
</div>
);
}

return (
<form onSubmit={handleSubmit} className="rounded-2xl border border-brand-border bg-white/5 p-8">
<h3 className="text-2xl font-bold">Help us improve</h3>
<p className="mt-2 text-sm text-text-secondary">Found a bug, have an idea, or just want to share your thoughts? Drop us a note — we read every one.</p>
<div className="mt-6 space-y-4">
<div style={{ position: "absolute", left: "-9999px" }} aria-hidden="true">
<label htmlFor="hp-company">Company</label>
<input id="hp-company" type="text" tabIndex={-1} autoComplete="off" value={company} onChange={(e) => setCompany(e.target.value)} />
</div>
<div>
<label htmlFor="fb-name" className="block text-sm font-medium mb-1">Name</label>
<input id="fb-name" type="text" value={name} onChange={(e) => setName(e.target.value)} required maxLength={100} className="w-full px-3 py-2 rounded-lg bg-brand-background border border-brand-border focus:border-brand-primary outline-none" />
</div>
<div>
<label htmlFor="fb-email" className="block text-sm font-medium mb-1">Email</label>
<input id="fb-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" className="w-full px-3 py-2 rounded-lg bg-brand-background border border-brand-border focus:border-brand-primary outline-none" />
<p className="mt-1 text-xs text-text-secondary">So we can follow up if needed. We won’t share it.</p>
</div>
<div>
<label htmlFor="fb-comment" className="block text-sm font-medium mb-1">Comment</label>
<textarea id="fb-comment" value={comment} onChange={(e) => setComment(e.target.value)} required maxLength={2000} rows={5} placeholder="Tell us what’s on your mind…" className="w-full px-3 py-2 rounded-lg bg-brand-background border border-brand-border focus:border-brand-primary outline-none resize-y" />
<p className="mt-1 text-xs text-text-secondary">{comment.length}/2000</p>
</div>
{error && (
<p className="text-sm text-red-400" role="alert">{error}</p>
)}
<button type="submit" disabled={status === "submitting"} className="w-full px-6 py-3 rounded-full font-semibold bg-brand-primary hover:bg-brand-primary-dark transition-colors text-white disabled:opacity-60 disabled:cursor-not-allowed">{status === "submitting" ? "Sending…" : "Send feedback"}</button>
</div>
</form>
);
}
