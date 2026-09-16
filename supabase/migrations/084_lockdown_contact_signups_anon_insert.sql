-- 084_lockdown_contact_signups_anon_insert
--
-- contact_signups carried a policy, "Public can submit contact signup",
-- allowing anon INSERT with nothing but a non-empty-email check. It has been
-- dead weight since it was written: every path that writes to this table runs
-- on the service role, which bypasses RLS entirely.
--
--   /api/contact-signup      getSupabaseAdmin() -- its own comment says the
--                            write "must run with the service role key, never
--                            the anon key"
--   /api/webhooks/tally      getSupabaseAdmin(), via upsert_contact_signup()
--   /api/admin/email-blast   read, admin route
--   /api/admin/sms-blast     read, admin route
--
-- Confirmed by grepping the whole repo -- src, mobile and melori-gallery -- for
-- contact_signups: those four are the only references, and none uses the anon
-- key. So the policy grants nothing the product needs and two things it does
-- not want:
--
--   1. Anyone holding the publishable key can write straight into the lead
--      list, skipping the signed Tally webhook, the honeypot, the IP rate
--      limit and the email-syntax gate on /api/contact-signup.
--   2. Since 081 put a unique index on email, a 23505 on insert is a yes/no
--      answer to "is this address on the list?" -- an enumeration oracle for
--      any address an attacker cares to try.
--
-- Table-level grants are revoked too. RLS with no policy already blocks anon,
-- but leaving the grants in place means a future migration that adds a
-- permissive policy silently re-opens the hole.

drop policy if exists "Public can submit contact signup" on public.contact_signups;

revoke all on table public.contact_signups from anon, authenticated;

comment on table public.contact_signups is
  'Deduplicated contact list, one row per person. Service-role only: write through upsert_contact_signup(), never a direct client insert.';
