import type { Metadata } from "next";
import OpenLetterForm from "@/components/openLetter/OpenLetterForm";

// Public (see PUBLIC_EXACT in src/proxy.ts): signers arrive from Facebook with
// no Melori account. Static on purpose — the count and signed-in prefill are
// read on the client, so nothing here makes the route dynamic (and therefore
// no-store, which WKWebView treats as a failed load).
//
// This is the PUBLIC version of Karl's letter. The private copies sent to his
// own representatives also carry his address, phone, Blessing's full name, the
// congressional-inquiry text and the traffic-stop story. Keep those out of here.

export const metadata: Metadata = {
  title: "Open letter: The Citizen Accountability Clause",
  description:
    "Let an American citizen vouch for the person they're going to marry. Read Karl Ray's open letter to Congress and add your name.",
  alternates: { canonical: "/open-letter" },
  openGraph: {
    title: "Let me stand behind the woman I love",
    description:
      "An open letter to Congress proposing the Citizen Accountability Clause. Read it and add your name.",
    url: "/open-letter",
    type: "article",
  },
};

const card = "rounded-xl border border-brand-border bg-brand-surface p-4";
const quote = "border-l-2 border-brand-primary pl-3 italic text-text-secondary";
const link = "text-brand-primary underline";

export default function OpenLetterPage() {
  return (
    <div className="bg-brand-background text-text-primary">
      <article className="max-w-xl mx-auto px-4 pt-10 pb-16 space-y-8">
        <header>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-primary mb-3">
            Open letter to Congress
          </p>
          <h1 className="text-3xl font-bold leading-tight mb-3">The Citizen Accountability Clause</h1>
          <p className="text-text-secondary">
            Let an American citizen vouch for the person they are going to marry: sign for them,
            stand behind them, and answer for them if they break the rules.
          </p>
          <a
            href="#sign"
            className="mt-5 inline-block rounded-lg bg-brand-primary px-5 py-3 font-semibold text-white"
          >
            Add your name
          </a>
        </header>

        <section className="space-y-4">
          <p>
            My name is Karl Ray. I am 56, a lifelong Chicagoan from the Pullman neighborhood, an
            author, musician, photographer, and the founder of Melori, a free platform for
            independent artists. My late father, Hilliard Ray, served this country as a military
            policeman in the U.S. Army in the late 1960s.
          </p>
          <p>
            The woman I am going to marry, Blessing, lives in Nigeria. We have been together since
            February 2025. In October 2026 I flew to Lagos, asked her to marry me, and she said
            yes. I traveled to her family&apos;s village and met her parents, her sister, and her
            friends, who welcomed me as one of their own. My family has not been allowed to meet
            her.
          </p>
          <p>
            Since January 1, 2026, Proclamation 10998 has suspended visitor visas for Nigerian
            nationals. At the same time, the State Department&apos;s own visa bond program lists
            Nigeria and already asks Nigerian visitors to post a $15,000 bond, which it says brings
            back 97% of bonded travelers on time. The government has built an accountability tool
            and then closed the door it was built for. And at $15,000 in cash, that tool is out of
            reach for working Americans.
          </p>
          <p className="font-semibold">
            I am not asking for the rules to be waived. I am asking for a way to take
            responsibility.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">What&apos;s broken</h2>
          <p className="text-text-secondary">
            Four federal rules now stack on a Nigerian fiancée, and none of them gives the American
            citizen a way to take responsibility for her.
          </p>
          <div className={card}>
            <h3 className="font-semibold">Proclamation 10998 (since Jan 1, 2026)</h3>
            <p className="text-sm text-text-secondary">
              Suspends Nigerian immigrant visas and visitor visas. A fiancée cannot even visit for
              Christmas.
            </p>
          </div>
          <div className={card}>
            <h3 className="font-semibold">Immigrant visa pause (since Jan 21, 2026)</h3>
            <p className="text-sm text-text-secondary">
              Indefinitely pauses immigrant visas for 75 countries including Nigeria, so a couple
              who marries abroad is stuck in the spousal line.
            </p>
          </div>
          <div className={card}>
            <h3 className="font-semibold">USCIS memo PM-602-0194 (since Jan 1, 2026)</h3>
            <p className="text-sm text-text-secondary">
              Held final decisions on petitions tied to travel-ban nationals. A federal court found
              the pause unlawful on June 5, 2026, but the government may appeal.
            </p>
          </div>
          <div className={card}>
            <h3 className="font-semibold">Visa bond program (expanded Apr 2, 2026)</h3>
            <p className="text-sm text-text-secondary">
              Requires a $15,000 bond for visitor visas. The State Department reports 97% of bonded
              travelers return on time, yet the proclamation blocks Nigerians from using it.
            </p>
          </div>
          <p className="text-text-secondary">
            The K-1 fiancée visa is the one family path still open. It runs 10 to 16 months from
            petition to interview. During that time the couple cannot spend a single holiday
            together on American soil, and the citizen has no legal way to say: I will answer for
            her.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">The proposal</h2>
          <p>
            A U.S. citizen with an approved or pending fiancé(e) (I-129F) or spousal (I-130)
            petition could sponsor that person for one limited visit while the case is pending, by
            taking on legal and financial responsibility for it.
          </p>
          <div className={card}>
            <h3 className="font-semibold mb-1">Who qualifies</h3>
            <ul className="list-disc pl-5 text-sm text-text-secondary space-y-1">
              <li>A U.S. citizen with a filed fiancé(e) or spousal petition for the visitor.</li>
              <li>The couple has met in person, the same proof the K-1 already requires.</li>
              <li>
                The visitor passes the same security and background vetting as anyone else. Nothing
                skips vetting.
              </li>
            </ul>
          </div>
          <div className={card}>
            <h3 className="font-semibold mb-1">What the citizen signs</h3>
            <ul className="list-disc pl-5 text-sm text-text-secondary space-y-1">
              <li>A binding guarantee that the visitor will leave by the date on the visa.</li>
              <li>
                A guarantee in place of a cash bond: if the visitor overstays, the citizen owes the
                government the cost of removal, collected like any federal debt. Any cash bond is
                scaled to income, never a flat $15,000.
              </li>
              <li>Financial responsibility for the visitor&apos;s costs during the stay.</li>
            </ul>
          </div>
          <div className={card}>
            <h3 className="font-semibold mb-1">If the rules are broken</h3>
            <ul className="list-disc pl-5 text-sm text-text-secondary space-y-1">
              <li>The citizen owes the guaranteed amount.</li>
              <li>The pending petition is closed, and the citizen can never use the clause again.</li>
              <li>The visitor becomes ineligible for future visas under ordinary overstay rules.</li>
            </ul>
          </div>
          <p className="text-text-secondary">
            It uses tools that already exist: the visa bond program, the affidavit of support, and
            K-1 relationship evidence. It puts the risk on the citizen asking for the favor instead
            of on taxpayers, without pricing out working families.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Why this feels like history repeating</h2>
          <p>
            This country once made fortunes moving Africans here against their will and splitting
            their families for profit. Today I am an American asking to bring one African woman
            here by choice, at my own expense, and the system answers with fees, bonds, and closed
            doors. From my book <em>Was It Just Business?</em>:
          </p>
          <p className={quote}>
            &ldquo;A sale was a business transaction. The family was not a party to it.&rdquo;
          </p>
          <p className={quote}>
            &ldquo;No one is held accountable, while the systems in place keep everything moving
            the way they always have.&rdquo;
          </p>
          <p>
            I am not saying today&apos;s rules are slavery. I am saying I know what it looks like
            when a system treats African families as a cost to be managed instead of people to be
            joined. I am asking for the opposite: let an American citizen be held accountable, so
            that a family can be made whole.
          </p>
        </section>

        <section className="space-y-3">
          <h2 className="text-xl font-bold">Where your signature goes</h2>
          <p className="text-text-secondary">
            Signatures and stories go to Rep. Robin Kelly (IL-2), Sen. Tammy Duckworth and Sen.
            Dick Durbin, and to their successors after January 3, 2027. We ask each office to
            support the clause and raise it with the State Department.
          </p>
          <p className="font-semibold">
            I am 56. I am not asking anyone to trust Blessing blindly. I am asking you to let me
            stand behind her.
          </p>
          <p>— Karl L. Ray, Chicago</p>
        </section>

        <section id="sign" className="space-y-4 scroll-mt-24">
          <h2 className="text-2xl font-bold">Add your name</h2>
          <OpenLetterForm />
        </section>

        <footer className="text-xs text-text-secondary space-y-2 border-t border-brand-border pt-6">
          <p>
            Sources:{" "}
            <a className={link} href="https://www.state.gov/releases/office-of-the-spokesperson/2026/03/state-department-expands-visa-bonds-to-combat-illegal-overstay-rates">
              U.S. State Department, visa bonds (Mar 2026)
            </a>
            ;{" "}
            <a className={link} href="https://jqklaw.com/nigerian-immigrants-2026-travel-ban-uscis-pause/">
              JQK Law, 2026 travel ban and USCIS pause
            </a>
            ;{" "}
            <a className={link} href="https://www.chidoluelaw.com/nigeria-fiance-visa-processing/">
              Chidolue Law Firm, Nigeria fiancé visa processing (Jun 2026)
            </a>
            .
          </p>
          <p>
            This page is advocacy, not legal advice. Talk to a licensed immigration attorney about
            your own case. Melori will never ask you for money or documents for visa help.
          </p>
        </footer>
      </article>
    </div>
  );
}
