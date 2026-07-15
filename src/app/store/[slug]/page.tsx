import Link from "next/link";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase";
import type { StoreProduct } from "@/types";
import ProductCard from "../ProductCard";
import AddToCart from "./AddToCart";
import { discountPercent, formatCents, resolvedPrice } from "../pricing";

export const revalidate = 60;

async function getProduct(slug: string): Promise<StoreProduct | null> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("store_products")
      .select("*")
      .eq("slug", slug)
      .eq("is_active", true)
      .single();
    if (error) return null;
    return data as StoreProduct;
  } catch {
    return null;
  }
}

async function getRelated(
  category: string,
  excludeId: string
): Promise<StoreProduct[]> {
  try {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("store_products")
      .select("*")
      .eq("category", category)
      .eq("is_active", true)
      .neq("id", excludeId)
      .limit(4);
    return (data as StoreProduct[]) ?? [];
  } catch {
    return [];
  }
}

export default async function ProductPage(
  props: {
    params: Promise<{ slug: string }>;
  }
) {
  const params = await props.params;
  const product = await getProduct(params.slug);
  if (!product) notFound();

  const related = await getRelated(product.category, product.id);
  const price = resolvedPrice(product);
  const off = discountPercent(product);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <nav className="mb-6 text-sm text-text-secondary">
        <Link href="/store" className="hover:text-brand-primary">
          Store
        </Link>
        <span className="mx-2">/</span>
        <span className="capitalize">{product.category}</span>
        <span className="mx-2">/</span>
        <span className="text-text-primary">{product.name}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2">
        <div className="relative overflow-hidden rounded-2xl border border-brand-border bg-black/40">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={product.image_url || "/logo/logo.png"}
            alt={product.name}
            className="aspect-square w-full object-cover"
          />
          {off > 0 && (
            <span className="absolute left-4 top-4 rounded-full bg-brand-primary px-3 py-1 text-sm font-bold text-black">
              -{off}%
            </span>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <div>
            <p className="text-sm uppercase tracking-wide text-text-secondary">
              {product.category}
            </p>
            <h1 className="mt-1 text-3xl font-bold">{product.name}</h1>
          </div>

          <div className="flex items-center gap-3">
            <span className="text-3xl font-bold text-brand-primary">
              {formatCents(price)}
            </span>
            {product.sale_price != null &&
              product.sale_price < product.price && (
                <span className="text-lg text-text-secondary line-through">
                  {formatCents(product.price)}
                </span>
              )}
          </div>

          <p className="leading-relaxed text-text-secondary">
            {product.description}
          </p>

          <AddToCart product={product} />
        </div>
      </div>

      {related.length > 0 && (
        <section className="mt-16">
          <h2 className="mb-6 text-2xl font-bold">You may also like</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
