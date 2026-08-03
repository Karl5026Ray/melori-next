# Melori legal & ops runbook

**Status: partial. Schema and findings are landed; the pages and flows are not built yet.**
Written 2026-08-03. This is engineering/ops research, **not legal advice** — have counsel
review the terms and the DMCA policy before you rely on them.

---

## 0. Read this first: two confirmed money findings

Both were verified against the live Stripe account (`acct_1KbwG02ETyPDQmbq`,
"Karlrayphotography") and Stripe's own docs, not from memory.

### 0.1 You currently pay the processing fee on every sale — not the artist

`src/lib/artist-payouts.ts` uses **destination charges** with `on_behalf_of` set to the
artist and **no `application_fee_amount`**. Stripe's Connect docs are explicit:

> "Any activity occurring at the platform account level is billed to your platform
> regardless of the entity responsible for fee collection. For example, Stripe charges the
> platform directly for destination charges (with or without `on_behalf_of`)."
> — [Fee behavior on connected accounts](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior)

So on a **$1.99 single**: the artist is transferred the full $1.99, and Stripe bills
Melori 2.9% + $0.30 = **~$0.36**, plus Connect volume fees. Melori nets **negative ~$0.36
per single sold**. On a $9.99 album it's ~ -$0.59. There is no cut anywhere to offset it.

The live copy says "No platform cut — artists keep every dollar **after payment
processing**", which implies the artist bears the fee. Reality is more generous to the
artist than the promise and worse for you than the promise. Three ways out, in order of
how much code they touch:

| Option | Change | Effect |
|---|---|---|
| **A. Charge the fee to the artist (smallest)** | Keep Express + destination charges, add `application_fee_amount` equal to the Stripe fee | Artist nets $1.99 − $0.36; copy becomes literally true; you break even. Requires computing the fee yourself. |
| **B. Switch new artists to Standard + direct charges** | `type: "standard"`, charge with the `Stripe-Account` header | Stripe bills the **artist** directly, artist bears disputes, **and Stripe files their 1099-K** (see 0.2). Biggest checkout change; receipts/customer relationship move to the artist. |
| **C. Absorb it deliberately** | Nothing | Fine only while volume is tiny. Document it as a subsidy so it isn't a surprise. |

**There are currently zero connected accounts** (`GET /v1/accounts` returns an empty
list). No artist has onboarded yet. That means an account-type change costs you **nothing
to migrate** right now, and gets progressively more expensive with every artist who
onboards. If you're going to do B, do it before the first payout.

### 0.2 With Express accounts, *you* are the 1099 filer of record — not Stripe

> "Stripe issues 1099-K forms for your connected accounts that have transactions where
> `controller.fees.payer` equals `account`, or where it equals
> `application_unified_accounts_beta` and the connected account pays the processing fees.
> For all other transactions where the platform controls the pricing, **the platform is
> responsible for filing any relevant 1099 forms**."
> — [US tax reporting for Connect platforms](https://docs.stripe.com/connect/tax-reporting)

Express accounts get `controller.fees.payer = application_express`, which is **not** in
that list. So as built, **Melori** must collect W-9s and file 1099s for US artists.
Options: turn on [Stripe's 1099 tax reporting product](https://docs.stripe.com/connect/get-started-tax-reporting)
and configure [tax form settings](https://docs.stripe.com/connect/tax-form-settings)
(Stripe prepares and e-delivers, you're still the payer of record), or switch to Standard
per option B above and the obligation moves to Stripe.

Thresholds — note these moved and most guides are stale:
- **1099-K: $20,000 AND 200 transactions** for 2025 and 2026, after the OBBBA restored the
  old limits ([IRS IR-2025-107](https://www.irs.gov/newsroom/irs-issues-faqs-on-form-1099-k-threshold-under-the-one-big-beautiful-bill-dollar-limit-reverts-to-20000)).
- **1099-NEC/MISC: $600 → $2,000** for payments made from 1 Jan 2026. Stripe's docs may
  still show $600.
- Realistically you will not hit 1099-K thresholds for a long time. The paperwork that
  matters sooner is the **W-9 / W-8BEN**, because of the next line.
- Stripe **disables payouts** once tax-reporting capabilities are active and a connected
  account passes **$600 cumulative charges** without verified tax info
  ([required verification info](https://docs.stripe.com/connect/required-verification-information-taxes)).
  Collect the W-9 at onboarding, not at $600.
- Missing/mismatched TIN → **24% backup withholding** after an IRS CP2100 notice
  ([IRS](https://www.irs.gov/businesses/small-businesses-self-employed/backup-withholding)).

**Why you don't need a money-transmitter licence:** because funds move through Connect and
never land in a Melori-controlled bank account. Don't ever route artist money through your
own account "just this once" — that is the line
([Stripe: global payouts vs Connect](https://docs.stripe.com/global-payouts/compare-with-connect)).

Also worth knowing: with Express, **negative balances and unrecoverable disputes on
destination charges fall on the platform**. Budget for chargebacks you can't claw back.

---

## 1. DMCA — the two things that are legally required and cheap

You have neither today. There is no `/legal/dmca` page, no takedown intake, no
counter-notice flow, and no strike ledger anywhere in the repo.

1. **Designate an agent with the Copyright Office.** Online only, **$6**, and it
   **expires after 3 years** — set a calendar reminder to re-file.
   [Directory](https://www.copyright.gov/dmca-directory/) ·
   [FAQ](https://www.copyright.gov/dmca-directory/faq.html)
2. **Post the same agent details publicly on the site** — name, physical address, phone,
   email. §512(c)(2) requires both postings *independently*; doing only the Copyright
   Office filing does not get you the safe harbour.
   [17 U.S.C. §512](https://www.law.cornell.edu/uscode/text/17/512)

Use a real address you're willing to publish. A registered-agent or PO-box-style service
is the normal answer for a solo founder who doesn't want a home address in a public
federal directory.

### Handling a notice
A valid notice needs all six §512(c)(3) elements: signature, identification of the work,
identification of the material, contact info, a good-faith statement, and a
penalty-of-perjury accuracy/authority statement. On receipt: **remove expeditiously**,
**promptly notify the uploader**, and **log it**. Migration 049 gives you the table to log
it in.

### Counter-notices
Need signature, identification, a penalty-of-perjury statement that removal was a mistake,
name/address/phone, consent to federal jurisdiction, and acceptance of service. If you get
a valid one, forward it and **restore in not less than 10 and not more than 14 business
days** unless the complainant tells you it has filed suit. Both ends of that window are
obligations — restoring early is as wrong as never restoring.

### Repeat infringers
§512(i) requires a policy that is **actually enforced**. *BMG v. Cox* (4th Cir. 2018) is
the case where a written-but-unenforced policy cost the safe harbour. Migration 049's
`copyright_strikes` table plus `active_strike_count()` exists so the policy is countable;
the documented threshold is **3 active strikes → account termination**, strikes expiring
after 12 months.

Two things that cut the other way and are worth knowing:
- **§512(f)** exposes bad-faith notice senders, and *Lenz v. Universal* requires a sender
  to consider fair use. You can push back on obvious junk notices.
- The Supreme Court decided ***Cox Communications v. Sony Music*, No. 24-171, on 25 March
  2026**: contributory infringement now needs inducement or a service "tailored to
  infringement" — mere knowledge isn't enough, and the $1B verdict was reversed
  ([slip opinion](https://www.supremecourt.gov/opinions/25pdf/24-171_bq7d.pdf)).
  This makes the secondary-liability tail much less scary. It does **not** remove the
  §512(i) requirement.

---

## 2. AI uploads

The exposure here isn't really copyright infringement by you — it's **selling something
the seller has no rights in**, and **voice cloning**.

- Purely AI-generated output **is not copyrightable**; prompts alone don't create
  authorship. Human-authored contributions to a hybrid work still are.
  [Copyright Office, Copyright and AI Part 2 (29 Jan 2025)](https://www.copyright.gov/ai/Copyright-and-Artificial-Intelligence-Part-2-Copyrightability-Report.pdf).
  Part 3 (training/infringement) is still pre-publication.
- **Suno's own terms (rev. 26 Mar 2026)**: free and Basic-tier output is **non-commercial
  only**; commercial rights start at Pro/Premier, and Suno disclaims any warranty that
  copyright vests at all ([suno.com/terms-of-service](https://suno.com/terms-of-service)).
  An artist selling free-tier Suno output on Melori is breaching Suno's licence. This is
  why migration 049 hard-requires `ai_commercial_rights = TRUE` whenever
  `ai_disclosure <> 'none'`.
- The training-data question is genuinely **unresolved**: WMG settled with Suno
  (25 Nov 2025) and UMG with Udio (29 Oct 2025), but *UMG v. Suno* and *Sony v.
  Suno/Udio* are still live and **no court has ruled on fair use**. Don't write terms that
  assume an answer either way.
- **Voice cloning is the sharpest edge.** Tennessee's **ELVIS Act** (effective 1 July
  2024) bans unauthorised AI voice imitation. The federal **NO FAKES Act (S.1367)** is
  still in committee and is *not* law. Ban unauthorised voice clones outright in the terms
  — this is the one AI rule worth a zero-tolerance stance.
- **EU AI Act Article 50** transparency duties apply from **2 August 2026** — i.e. now
  ([EC](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content)).
  It binds providers/deployers of the GenAI system more than a downstream host, and
  California's SB 942 likewise binds GenAI *system creators*, not hosts. But if you have
  any EU users, a visible "AI-assisted / AI-generated" label is the cheap defensive move —
  hence `ai_disclosure` being denormalised onto `tracks` and `studio_tracks` for display.

**Do not promise buyers they get copyright in an AI track.** Sell it as a licence to the
recording, and say plainly that AI-generated material may not be protectable.

---

## 3. Cover songs — the path that actually fits Melori's size

§115 mechanical licences cover the **composition only**, and only if you don't change the
melody or lyrics. No remixes, no mashups, no sampling, no sync
([Circular 73](https://www.copyright.gov/circs/circ73.pdf)).

**2026 statutory rate: 13.1¢ per work, or 2.52¢ per minute, whichever is greater** (up
from 12.7¢ / 2.45¢) —
[Federal Register](https://www.federalregister.gov/documents/full_text/xml/2025/12/01/2025-21695.xml) ·
[37 CFR 385.11](https://www.law.cornell.edu/cfr/text/37/385.11).

**Recommendation: do not become an MLC blanket licensee.** The blanket licence covers
streaming and, if you register as a DMP, downloads — but it comes with monthly usage
reporting, royalty remittance, and audit exposure. That's a back-office function you don't
have. Instead, **make the artist hold the licence**, which is exactly what the closest peer
does:

- **Bandcamp requires the artist to already hold both a mechanical licence (for downloads)
  and a performance licence (for streaming) before uploading a cover**
  ([Bandcamp](https://get.bandcamp.help/en/articles/15263391-can-i-upload-covers-remixes-or-mashups)).
- **DistroKid** brokers one per upload through HFA
  ([DistroKid](https://support.distrokid.com/hc/en-us/articles/360013648953-Uploading-Cover-Songs-to-DistroKid)).
- **CD Baby exited the business** and now refers people to Easy Song
  ([CD Baby](https://cdbaby.com/music-distribution/cover-song-licensing/)).

So: point artists at **HFA/Songfile** or **Easy Song** (~$19.99/song + royalties) for
permanent downloads, and **require a licence reference at upload**. Migration 049 enforces
this in the database — a `rights_basis = 'cover'` row cannot be stored without
`mechanical_license_source` and `cover_work_title`.

**The open cost you should know about:** because Melori streams (even 30-second previews
and Superfan playback) from its own servers, that's a public performance, which needs
**PRO licences** — ASCAP, BMI, SESAC, GMR. BMI's digital licence starts around
**$350/yr** and a realistic all-in budget is roughly **$1,000–$8,000+/yr**
([ASCAP](https://www.ascap.com/music-users/types/website-mobile-app-landing-page) ·
[BMI](https://www.bmi.com/digital_licensing)). If the catalogue is 100% original works
whose writers are the uploading artists, your practical exposure is low today — but it
grows the moment covers are allowed at scale. Treat "allow covers" and "buy PRO licences"
as the same decision.

---

## 4. What's landed vs. what's left

### Landed in this branch
- `supabase/migrations/049_rights_takedowns_and_strikes.sql` — **not yet applied to
  production.** Additive and idempotent, same conventions as 015/046/048. It adds:
  - `rights_basis` + `ai_disclosure` on `tracks` and `studio_tracks` (nullable on purpose
    — NULL means "never asked"; back-filling would fabricate a representation the artist
    never made)
  - `rights_attestations` — append-only per-upload evidence, deliberately **no FK** to the
    item so it survives a takedown
  - **moderation columns on `studio_tracks`** — this closes the worst gap in the repo:
    `tracks` got moderation in migration 015, but `studio_tracks`, the table holding the
    tracks that are actually **for sale**, had no takedown lever at all
  - `takedown_notices` — notices and §512(g) counter-notices, RLS closed to everything but
    the service role because notices contain complainants' home addresses
  - `copyright_strikes` + `active_strike_count()` — expiring, voidable, one-per-notice
- This runbook.

### Left to build
1. **Public pages**: `/legal/dmca` (with the agent block), `/legal/dmca/report`,
   `/legal/counter-notice`, `/legal/covers`, `/legal/ai-music`, `/legal/payouts`;
   footer links.
2. **Rewrite `/terms`.** It's currently **91 lines** with no licence grant, no UGC
   representations or warranties, no indemnity, no AI clause, no covers clause, no DMCA
   reference, no payout/tax terms, no termination or strike policy, and no governing law.
   It also still says "You retain 100% ownership of your music" — reword, since we removed
   every "100%" claim in PR #255.
3. **Attestation UI + server enforcement** on both upload paths — `/upload` →
   `POST /api/artist/tracks`, and studio `TrackUploader` → `POST /api/studio/tracks`.
   Enforce server-side, not just in the form.
4. **Takedown intake API + admin queue** at `/admin/takedowns`, reusing `requireAdmin()`
   from `src/lib/admin-panel.ts` and writing to `audit_logs` the way
   `PATCH /api/admin/moderation/tracks/[id]` already does. The Resend connector is
   available for the uploader-notification emails.
5. **A `src/lib/legalContacts.ts`** env-driven DMCA agent block. Follow the
   `src/lib/socialLinks.ts` precedent from PR #255: render real details or render nothing —
   never a placeholder. A fake DMCA address is worse than no page.
6. **Public read filters**: every public query against `studio_tracks` must start
   filtering `moderation_status = 'clean'` once 049 is applied, or the new takedown lever
   won't actually hide anything.

### Your non-code to-do list
- [ ] File the DMCA agent designation ($6) and put a 3-year renewal reminder in the calendar
- [ ] Decide the address you're willing to publish
- [ ] Decide **Express vs Standard** (§0.1 / §0.2) — free to change today, costly after the first artist onboards
- [ ] If staying on Express: turn on Stripe 1099 tax reporting and collect W-9s at onboarding
- [ ] Decide whether covers are allowed at all, and if so budget PRO licences
- [ ] Run migration 048 (still pending from PR #255) and then 049 against production Supabase
- [ ] Send real Facebook / Instagram / X profile URLs for `NEXT_PUBLIC_SOCIAL_*` (still outstanding from PR #255)
- [ ] Have a lawyer review the terms and the DMCA policy before launch-scale promotion
