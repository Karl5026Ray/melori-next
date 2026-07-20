# mobile/ — Melori Music native app wrapper

Capacitor wrapper that packages the live **melorimusic.org** PWA into native iOS
(and later Android) apps for the App Store / Google Play.

## Architecture: remote-URL wrapper

Melori is a full server-rendered Next.js app (SSR, API routes, Supabase auth,
Stripe, LiveKit, VPS rewrites) — it can't be exported to static files. So the
native shell loads the **live site** in a WebView via `server.url` in
`capacitor.config.json`. Benefits:

- Content/features update automatically from Vercel — no app rebuild for changes.
- One source of truth (the web app); no code duplication.
- Rebuild the native app only for icon/name/permission/version changes.

## Files

| File | Purpose |
|---|---|
| `capacitor.config.json` | App ID `org.melorimusic.app`, name, `server.url` → live site, allowed navigation hosts, dark `#111111` background |
| `www/index.html` | Branded offline/splash fallback (shown only if the WebView can't reach the site) |
| `resources/icon-1024.png` | App Store icon source (1024², no alpha) |
| `resources/logo-source-1200.png` | Original logo, for regenerating assets |
| `BUILD_IOS.md` | Full step-by-step Mac build + upload guide |
| `package.json` | Capacitor deps + helper scripts |

The generated `ios/` and `android/` native projects are **git-ignored** — they're
created locally with `npx cap add ios` and regenerated rather than committed.

## Quick start (Mac)

```bash
cd mobile
npm install
npx cap add ios
npx cap sync ios
npx cap open ios     # then Archive → Distribute in Xcode
```

See **BUILD_IOS.md** for the complete walkthrough.
