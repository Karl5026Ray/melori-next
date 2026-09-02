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

## Why the CSS layer is the load-bearing one, not a backstop

The three rejections through 31 Aug 2026 all happened while the route gate was
working correctly. The route gate was never the problem. The leak was
**affordances**: a price in a `<span>`, an upgrade banner, a `<button>` that
`router.push("/membership")`. None of those is an `<a href>`, so no route
selector could see them, and `scripts/native-commerce-gate.test.ts` passed
throughout.

The obvious fix — read the user agent server-side and render the native branch
on the server — is **not available here**. The catalog pages are ISR-cached
(`export const revalidate = 60`) on purpose: `force-dynamic` makes Next stamp
`Cache-Control: no-store`, and iOS WKWebView discards a `no-store` response and
shows "This page couldn't load" (issue #280, see the comment block at the top of
`src/app/page.tsx`). One cached HTML body is shared by web and app visitors, so
the server cannot know the platform without breaking the app's ability to load.

That makes `data-native-hide` + the pre-paint CSS the primary mechanism, and the
`useIsNativeApp()` conditionals the second layer, not the other way round.

**Rule: anything that shows a price or asks for a purchase carries
`data-native-hide`, unless it is an anchor to a route the proxy already blocks.**
`scripts/native-commerce-affordances.test.ts` enforces this across all of `src/`
and will fail on a new one.

Sites fixed on 2 Sep 2026, verified visible in a real browser with the gate
active before the fix: the 30-second-preview upgrade banner in `AudioPlayer`
(the most exposed one — it fires the first time a reviewer presses play), the
price on every `CatalogCard`, the single-track and album prices, the
"Buy digital copies ... securely via Stripe" gallery feature, the home
value-prop cards, the Go Superfan buttons in `RoomChat` and `FacesLiveChat`, and
the seller-payout block on `/register`.

## Music and photo downloads are web-only

Apple's second 3.1.1 finding on submission 6c0eeca5: "The app accesses digital
content purchased outside the app, such as Music, but that content isn't
available to purchase using In-App Purchase," with next steps citing guideline
3.1.3(b) — access to content bought elsewhere is permitted only when the same
content is also purchasable via IAP.

Music sales stay on the web, because IAP would take 15-30% and Apple has no
equivalent of the Stripe Connect destination charges and transfers that
`src/lib/split-payouts.ts` uses to pay collaborating artists. So the answer is
the other half of the rule: **the app does not access them at all.**

Blocked for native requests as of 2 Sep 2026:
- pages `/music/success`, `/gallery/purchase`, `/download-success`
- APIs `/api/music/download`, `/api/gallery/download`

Blocking the pages is presentation; blocking the two APIs is what actually makes
a web purchase undeliverable inside the wrapper, since they are the signed-URL
handoff. Free 30-second previews are untouched — free content is not at issue.
Superfan streaming is untouched too, and is covered instead by the subscription
IAP rail: once subscriptions are purchasable in-app, 3.1.3(b) is satisfied for
subscription content.

## Adding a new paid feature

1. Add the route to `BLOCKED_PAGE_PREFIXES` (or the handler to
   `BLOCKED_API_PATHS`) in `src/lib/nativePlatform.ts`.
2. Add exact and slash-delimited selectors to `src/app/native-app.css`.
3. Gate the component with `useIsNativeApp()` AND mark any price or purchase
   copy with `data-native-hide`. The marker is what covers the pre-hydration
   frame and every ISR-cached page; the hook alone is not enough.

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
- [ ] `npm run test:native-affordances` passes.
- [ ] Press play on any track, let the 30-second preview end, and confirm no
      upgrade banner appears.
- [ ] Sweep the live site the way the fix was verified: load each public route
      with `document.documentElement.dataset.nativeApp = "1"` set and assert no
      visible text matches a price or a purchase verb.
