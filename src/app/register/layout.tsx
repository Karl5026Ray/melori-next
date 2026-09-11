import "../auth-door.css";

// Sign-up / sign-in door: the site menu is hidden while this page is open
// (see src/app/auth-door.css). "/" for a signed-out visitor is rewritten to
// /platform, so the home-page door gets this too. `display: contents` means
// the wrapper adds no box of its own — the page lays out exactly as before.
export default function DoorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="auth-door-shell" style={{ display: "contents" }}>
      {children}
    </div>
  );
}
