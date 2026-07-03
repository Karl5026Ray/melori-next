"use client";

import { useRouter, useSearchParams } from "next/navigation";

const CATEGORIES = [
  { label: "All", value: "" },
  { label: "Apparel", value: "apparel" },
  { label: "Accessories", value: "accessories" },
  { label: "Art", value: "art" },
  { label: "Tech", value: "tech" },
  { label: "Home", value: "home" },
];

const SORTS = [
  { label: "Newest", value: "newest" },
  { label: "Price: Low to High", value: "price-low" },
  { label: "Price: High to Low", value: "price-high" },
  { label: "Most Popular", value: "popular" },
];

export default function StoreControls() {
  const router = useRouter();
  const params = useSearchParams();
  const category = params.get("category") ?? "";
  const sort = params.get("sort") ?? "newest";

  function update(next: { category?: string; sort?: string }) {
    const sp = new URLSearchParams(params.toString());
    if (next.category !== undefined) {
      if (next.category) sp.set("category", next.category);
      else sp.delete("category");
    }
    if (next.sort !== undefined) {
      if (next.sort && next.sort !== "newest") sp.set("sort", next.sort);
      else sp.delete("sort");
    }
    const qs = sp.toString();
    router.push(qs ? `/store?${qs}` : "/store");
  }

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap gap-2">
        {CATEGORIES.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => update({ category: c.value })}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              category === c.value
                ? "bg-brand-primary text-black"
                : "border border-brand-border text-text-secondary hover:text-brand-primary"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>
      <select
        value={sort}
        onChange={(e) => update({ sort: e.target.value })}
        className="rounded-md border border-brand-border bg-black/40 px-3 py-2 text-sm text-text-primary focus:border-brand-primary focus:outline-none"
      >
        {SORTS.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>
    </div>
  );
}
