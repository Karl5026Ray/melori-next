// Global loading state.
// WAS BROKEN: the app had no loading.tsx, so navigations that trigger data
// fetching showed no feedback during suspense — the UI simply froze on the
// previous page until the next one was ready.
// FIX: a lightweight, on-brand loading indicator shown automatically by
// Next.js during route-segment suspense. Purely additive; no UX-flow change.

export default function Loading() {
return (
<div
className="flex min-h-[50vh] items-center justify-center"
role="status"
aria-live="polite"
>
<span
className="h-10 w-10 animate-spin rounded-full border-4 border-brand-border border-t-brand-primary"
aria-hidden
/>
<span className="sr-only">Loading…</span>
</div>
);
}
