import { createServiceClient } from "@/lib/supabase";
import type { StoreProduct } from "@/types";
import ProductCard from "./ProductCard";
import StoreControls from "./StoreControls";

export const revalidate = 60;

type SortKey = "newest" | "price-low" | "price-high" | "popular";

async function getProducts(
  category: string,
  sort: SortKey
): Promise<StoreProduct[]> {
  try {
    const supabase = createServiceClient();
    let query = supabase
      .from("store_products")
      .select("*")
      .eq("is_active", true);

    if (category) query = query.eq("category", category);

    switch (sort) {
      case "price-low":
        query = query.order("price", { ascending: true });
        break;
      case "price-high":
        query = query.order("price", { ascending: false });
        break;
      case "popular":
        query = query.order("sold_count", { ascending: false });
        break;
      default:
        query = query.order("created_at", { ascending: false });
    }

    const { data, error } = await query;
    if (error) throw error;
    return (data as StoreProduct[]) ?? [];
  } catch (err) {
    console.error("store list error", err);
    return [];
  }
}

export default async function StorePage({
  searchParams,
}: {
  searchParams: { category?: string; sort?: string };
}) {
  const category = searchParams.category ?? "";
  const sort = (searchParams.sort as SortKey) ?? "newest";
  const products = await getProducts(category, sort);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold sm:text-4xl">
          Melori <span className="text-brand-primary">Store</span>
        </h1>
        <p className="mt-2 text-text-secondary">
          Official merch. Free shipping on orders over $50.
        </p>
      </header>

      <div className="mb-8">
        <StoreControls />
      </div>

      {products.length === 0 ? (
        <div className="rounded-xl border border-brand-border bg-black/30 p-12 text-center text-text-secondary">
          No products found in this category yet. Check back soon.
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </main>
  );
}
