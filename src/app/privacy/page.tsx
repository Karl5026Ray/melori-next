import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How MELORI Music handles your data.",
};

// Keep this page in step with the Google Play Data safety form and the App
// Store privacy labels. Google rejects listings whose form and policy disagree,
// so any new data the app collects must be added here in the same change.

const LINK = "text-brand-primary hover:underline";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-xl font-semibold text-text-primary mb-2">{title}</h2>
      {children}
    </section>
  );
}

export default function PrivacyPage() {
  return (
    <div className="bg-brand-background text-text-primary">
      <div className="max-w-3xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-4">Privacy Policy</h1>
        <p className="text-sm text-text-secondary mb-10">
          Last updated: October 11, 2026
        </p>

        <div className="space-y-8 text-text-secondary leading-relaxed">
          <p>
            This policy covers the Melori Music website (melorimusic.org) and
            the Melori Music apps for Android and iOS. Melori is operated by
            Karl Ray, Chicago, Illinois, USA. Melori is free: there is nothing
            to buy, and we collect no payment information.
          </p>

          <Section title="What we collect">
            <ul className="list-disc pl-5 space-y-2">
              <li>
                <strong>Account details</strong> — your email address and
                password (stored hashed), or the name and email shared by Google
                or Apple if you sign in with them.
              </li>
              <li>
                <strong>Profile</strong> — username, display name, bio, profile
                photo and, if you provide it, your date of birth.
              </li>
              <li>
                <strong>Phone number</strong> — only if you go live. We verify
                it once to keep live rooms safe.
              </li>
              <li>
                <strong>Content you share</strong> — music, videos, photos,
                comments, direct messages, room chat, and live audio/video while
                you are in a live room. Room recordings are only made with the
                consent of everyone in the room and stay private unless the host
                posts them.
              </li>
              <li>
                <strong>Melori Connect (optional, 18+)</strong> — if you create a
                Connect profile: date of birth, gender, who you want to see, age
                range, city (typed by you, not from your device&apos;s GPS),
                prompts and photos, plus your likes, passes and matches.
              </li>
              <li>
                <strong>Activity</strong> — what you listen to, follow, like and
                save, reports you file, and when you were last online.
              </li>
              <li>
                <strong>Technical data</strong> — IP address (to prevent abuse
                and rate-limit requests) and anonymous, cookie-free page-view
                statistics from Cloudflare Web Analytics.
              </li>
              <li>
                <strong>Google Calendar</strong> — only for photographers who
                choose to connect a calendar for bookings.
              </li>
            </ul>
            <p className="mt-3">
              We do not collect your contacts, precise location, health
              information or payment details.
            </p>
          </Section>

          <Section title="Camera and microphone">
            <p>
              The apps ask for camera and microphone access only when you choose
              to go live or join a live room on stage. You can turn them off at
              any time in your device settings.
            </p>
          </Section>

          <Section title="How we use it">
            <p>
              To run your account, show your content to the people you share it
              with, power live rooms and messaging, recommend music, keep the
              community safe (including automated screening of uploads for
              nudity and other policy violations, and human review of reports),
              and send account email such as sign-in links and notices.
            </p>
          </Section>

          <Section title="Who we share it with">
            <p className="mb-2">
              We don&apos;t sell your data, we don&apos;t show ads, and we
              don&apos;t track you across other apps or websites. We share data
              only with the service providers that run Melori on our behalf:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Supabase — database, sign-in and file storage</li>
              <li>Vercel and Cloudflare — hosting, security and content moderation screening</li>
              <li>LiveKit — live audio and video rooms</li>
              <li>Resend — account email</li>
              <li>Telnyx — phone verification for going live</li>
              <li>Google and Apple — only if you sign in with them</li>
            </ul>
            <p className="mt-2">
              We may also disclose information if required by law. Content you
              post publicly is visible to other Melori users.
            </p>
          </Section>

          <Section title="Security">
            <p>
              All data is encrypted in transit (HTTPS). Access to stored data is
              limited to the services above and to Melori administrators for
              moderation and support.
            </p>
          </Section>

          <Section title="Keeping and deleting your data">
            <p>
              We keep your data while your account is open. You can delete your
              account at any time in Settings → Delete account, or at{" "}
              <a href="/account/delete" className={LINK}>
                melorimusic.org/account/delete
              </a>
              . Deleting removes your profile, login, content, messages,
              Connect profile and activity. Uploaded files are cleared from
              storage shortly afterwards. To request a copy of your data, email
              us.
            </p>
          </Section>

          <Section title="Age">
            <p>
              Melori is for people 16 and older. Melori Connect is for people 18
              and older and checks your date of birth. If we learn an account
              belongs to someone younger, we remove it.
            </p>
          </Section>

          <Section title="Cookies">
            <p>
              Essential cookies only, to keep you signed in. No tracking cookies
              and no advertising pixels.
            </p>
          </Section>

          <Section title="Changes">
            <p>
              If we change this policy we will update the date above, and tell
              you in the app for significant changes.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions or requests? Email{" "}
              <a href="mailto:support@melorimusic.org" className={LINK}>
                support@melorimusic.org
              </a>
              .
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
}
