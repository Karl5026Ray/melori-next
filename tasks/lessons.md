# Lessons

Patterns to not repeat. Each entry is a correction that cost real time.

## Migrations

- **Never trust the local `supabase/migrations` folder alone.** This repo has
  had prefix collisions at 021, 048 and 054 where a file existed but was never
  applied to production. Confirm against the live project ledger
  (`list_migrations` on `ouvovhwizsuhjxxmccex`, *not* `wwkeypbfwenmcphorvyc`)
  before choosing a number or assuming something landed.
  `npm run test:migration-prefix` guards the filenames; it cannot guard what
  was applied.

## Apple / iOS

- **The native app IS the website.** `server.url` points at melorimusic.org, so
  "remove it from the iOS app" is never a native change — it is a change to
  what the site serves when the `MeloriApp` user agent is present.
- **Physical goods must NOT use IAP.** Guideline 3.1.5(a). Merch and photo
  bookings being gated out of the app was over-correction: Apple *requires*
  them to use Stripe. Digital goods (subscriptions, coins, music) are the
  opposite. The rule splits on what is being sold, not on where.
- **Auto-renew off is not a cancellation.** `DID_CHANGE_RENEWAL_STATUS` with
  `AUTO_RENEW_DISABLED` means the subscriber has still paid through the period.
  Revoking there is the most common IAP integration bug and generates refunds.
- **Do not feed StoreKit amounts to `classifyPrice()`.** Its final safety net
  grants Superfan for any positive amount — correct for Stripe (one currency we
  set), silently wrong for Apple (storefront currency). Apple gets an explicit
  product-id map and no fallback.

- **A passing gate test is not a working gate.** `native-commerce-gate.test.ts`
  passed through all three rejections. It pinned routes and anchors; the leak was
  prices in `<span>`s and CTAs in `<button>`s. Test the OUTPUT a reviewer sees,
  not the mechanism you built.
- **Verify in a real browser, not in the source.** Loading the live site with
  `data-native-app="1"` set and enumerating *visibly rendered* price/CTA text
  found eight leaks in minutes that reading the code had not. Do this before
  telling Apple anything is fixed.
- **`force-dynamic` is not an option on this codebase.** It makes Next stamp
  `no-store`, which iOS WKWebView treats as a failed load (issue #280). Any
  "just read the user agent on the server" fix will break the app worse than the
  bug it fixes.

## Billing

- **A tier that is on sale must exist end to end.** Snappd had live Stripe
  payment links and a signup tile, but no case in `classifyPrice()` and no room
  in the `profiles_role_check` constraint. A $14.99/mo buyer would have been
  provisioned as a $2.99 Superfan. Selling something is not the same as being
  able to deliver it — check the classifier AND the database constraint.
- **A code-only fix can be worse than the bug.** Teaching `classifyPrice()` to
  return "snappd" without extending the CHECK constraint would have made the
  webhook raise 23514, return 500, and let Stripe retry forever against a
  customer who had already been charged. Schema and code ship together.

## Process

- **Verify state before destroying it.** Asked to "stop the review because it
  got rejected", the rejection could not be confirmed — the last rejection
  email was four days old and build 21 had only a TestFlight notice. Cancelling
  an in-review submission on an unverified assumption throws away days.
- **Check the paperwork dependency first.** No IAP product can be created until
  the Paid Applications Agreement, banking and tax forms are complete. A day of
  code is worthless if that gate is closed.
