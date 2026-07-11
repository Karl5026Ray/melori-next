# MELORI Brand Guidelines

> Extracted from the live site **https://melorimusic.org** on 2026-06-27. These are the authoritative brand values for the rebuild. Do NOT invent new colors, logos, or fonts.

## Logo
- File: `/public/logo/logo.png` (source: `https://melorimusic.org/images/melori-logo.png`, 1200×1200 PNG, RGBA/transparent)
- Description: Stylized "M" with red→orange and teal gradients, two rounded note-head feet (orange left, teal right).
- Usage: Header left-aligned (next to "MELORI MUSIC" wordmark), footer left-aligned/centered to match current site.
- Minimum size: 120px width (rendered ~35px in header on current site).

## Colors
The live site uses a **dark theme** as its primary (and only active) mode.

- Primary: `#ff5500` — buttons (e.g. "Support"), links, accents, active/hover states
- Primary (dark variant): `#cc4400` — pressed/darker accent
- Theme color (meta / accent alt): `#ff8c00`
- Background: `#111111` — page background
- Surface: `#1e1e1e` — cards, panels
- Muted Surface: `#282828`
- Secondary (button bg): `#2d2d2d`
- Text Primary: `#ffffff` — headings, body text
- Text Secondary: `#b2b2b2` — muted text, labels
- Border: `#2d2d2d` — dividers, card borders
- Input Border: `#383838`

### Gradients
- Hero glow: `radial-gradient(ellipse at center, rgba(255,85,0,0.18) 0%, rgba(255,85,0,0.08) 35%, transparent 70%)`
- Accent gradient utilities used on current site: `#ff8c00` → `#ff5500`; surface `#1e1e1e` → `#0a0a0a`/`#111111`.

## Typography
- Font Family: **Inter** (primary, via Google Fonts), resolving through a system-font stack.
- Full sans stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, "Inter", sans-serif`
- Mono: `Menlo, monospace`
- Headings: Inter, bold weights. Body: Inter, regular.
- Import (minimal — only Inter is actually used in UI):
  `https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap`

## QR Code
- **NOT PRESENT on the current live site.** A full search of homepage, membership, contact, and footer found no QR code.
- Action: Do not invent one (brand rule forbids new assets). A footer placeholder slot is reserved; Karl to provide a QR image later → would live at `/public/images/qr-code.png`.

## Favicon
- File: `/public/favicon.png` (source: `https://melorimusic.org/images/melori-logo.png` — current site uses the logo PNG as favicon + apple-touch-icon)

## Open Graph
- og:title: `MELORI MUSIC`
- og:description: `Stream freely. Support directly. Create endlessly.`
- og:image: `/public/images/og-image.png` (source: same logo PNG on current site)
- meta description: `Independent music from Karl Ray, KAIEL R, Gloria Joy Rivers, Gbenga Yakubu, and more. Stream, download and support independent artists on Melori Music.`
- theme-color: `#ff8c00`
- apple-mobile-web-app-title: `Melori`

## Navigation (from current site)
- Header: Music, Videos, Artists, Membership, Info (dropdown), Dashboard (dropdown), My Account
- Footer: Privacy Policy (`/privacy.html`), Terms of Service (`/terms.html`)
- Footer text: "© 2026 MELORI MUSIC. All rights reserved." · "Karl Ray | Founder" · "High-quality music, delivered digitally."

> NOTE: Spec Section 7 Step 4 specifies a simpler Phase-1 nav (Music, Artists, Membership placeholder, About). The current live site has more items (Videos, Dashboard, etc.) which are out of Phase-1 scope. Phase-1 header follows the spec; full nav parity is a later phase.
