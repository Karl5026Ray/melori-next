import StudioGuard from "./StudioGuard";

export default function StudioLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <StudioGuard>{children}</StudioGuard>;
}
