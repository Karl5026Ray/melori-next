import { cn } from "@/lib/social";

interface BadgeProps {
  children: React.ReactNode;
  variant?: "purple" | "pink" | "green" | "orange" | "default";
  className?: string;
}

const variants = {
  purple: "bg-melori-purple/10 text-melori-purple border-melori-purple/20",
  pink: "bg-melori-pink/10 text-melori-pink border-melori-pink/20",
  green: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  orange: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  default: "bg-melori-elevated text-melori-muted border-melori-border",
};

export function Badge({
  children,
  variant = "default",
  className,
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
