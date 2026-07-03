import { CartProvider } from "./CartProvider";
import StoreNav from "./StoreNav";

export const metadata = {
  title: "Store — Melori Music",
  description: "Official Melori Music merchandise: apparel, accessories, and art.",
};

export default function StoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <CartProvider>
      <div className="min-h-screen bg-brand-background text-text-primary">
        <StoreNav />
        {children}
      </div>
    </CartProvider>
  );
}
