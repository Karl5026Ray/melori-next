# iOS App Store compliance — Guideline 3.1.1

## The problem this solves

`mobile/capacitor.config.json` sets `server.url` to `https://melorimusic.org`.
**The native app is this website.** There is no separate iOS bundle, so there is
no such thing as "removing a feature from the iOS app" — the only lever is what
the site serves when it is being rendered inside the wrapper.

Melori Music 1.0.2 was rejected three times under Guideline 3.1.1. Apple's
findings were that the app took donations through a non-IAP mechanism, music
could be purchased in the app with non-IAP payment, and subscription content
purchased outside the app was unlocked without an IAP purchase path.

## How the gate works

Three layers, in order of authority.

### 1. Enforcement — `src/proxy.ts` (Next 16 middleware)

Native requests are identified by the `MeloriApp` token that Capacitor appends
to the WebView user agent (`appendUserAgent` in
`mobile/capacitor.config.json`). For those requests:

- Commerce **pages** (`/donate`, `/checkout`, `/cart`, `/store`, `/pricing`,
  `/book`, `/membership`, and `/register?tier=` for paid tiers) redirect to
  `/account-info`.
- Checkout **APIs** (`/api/donate/checkout`, `/api/music/checkout`,
  `/api/store/checkout`, `/api/gallery/checkout`, `/api/gifts/checkout`,
  `/api/booking/create`) return `403`.

This is what actually makes purchasing unreachable. Everything else is
presentation. Web traffic is untouched.

### 2. Intent — `useIsNativeApp()`

`src/components/NativeAppProvider.tsx` exposes the platform to components.
`BuyButton`, `UpgradePrompt`, `GiftPicker` and `FooterLinks` render no purchase
affordance and no price inside the wrapper.

### 3. Backstop — `src/app/native-app.css`

A single rule hides any anchor pointing at a commerce route. The bootstrap
script at the top of `<body>` in `src/app/layout.tsx` sets
`data-native-app="1"` before anything can paint.

Route selectors use exact, query/hash, and slash-delimited descendant matches.
This mirrors `matchesPrefix()` in `src/lib/nativePlatform.ts` while preserving
non-commerce similarly-prefixed routes, such as `/bookmarks`.

## Adding a new paid feature

1. Add the route to `BLOCKED_PAGE_PREFIXES` (or the handler to
   `BLOCKED_API_PATHS`) in `src/lib/nativePlatform.ts`.
2. Add exact and slash-delimited selectors to `src/app/native-app.css`.
3. Gate the component with `useIsNativeApp()` and make sure the native branch
   shows no price and no call to action.

## Copy rules inside the app

Apple treats a call to action to purchase elsewhere as an alternative payment
mechanism. Inside the wrapper there must be no price, no plan name with an
amount, no "upgrade", "subscribe", "buy" or "donate" button, and no link or URL
that leads to a purchase — on this site or any other. Stating that account
settings are handled outside the app is permitted; steering someone toward a
purchase is not.

## Regression guard

`scripts/native-commerce-gate.test.ts` pins the UA token, blocked pages and
APIs, CSS route boundaries, the proxy matcher, and the required Capacitor
configuration. It runs as part of `npm run test:unit`, or on its own:

```
npm run test:native-gate
```

## Pre-submission checklist

- [ ] In the running app, confirm the WebView user agent contains `MeloriApp`.
- [ ] Confirm `document.documentElement.dataset.nativeApp === "1"`.
- [ ] Header and drawer show no Donate button or membership link.
- [ ] Footer shows no Membership or Donate link.
- [ ] Track rows and release pages show no Buy button or price.
- [ ] The menu shows no Store, Pricing, Book, or paid Signup tiles.
- [ ] Navigating directly to commerce pages lands on `/account-info`.
- [ ] `POST /api/music/checkout` from the app returns `403`.
- [ ] In a live room, the gift sheet shows no Coins button or packs.
- [ ] `mobile/capacitor.config.json` `allowNavigation` contains no Stripe host.
