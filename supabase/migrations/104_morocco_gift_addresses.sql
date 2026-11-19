-- 104: Morocco trip gift addresses (/morocco/thank-you).
--
-- Supporters of the Marrakech trip (melorimusic.org/morocco) pay through
-- Stripe payment links. The $50 and $100 tiers come with a postcard and a
-- signed print (and a hardcover at $100), which have to be mailed.
--
-- Karl: "ask if people are okay with sharing info for the gift first. I don't
-- want to frighten people." So checkout no longer asks for an address. After
-- paying, Stripe redirects to /morocco/thank-you, which offers an OPTIONAL
-- form. Nothing is stored unless the supporter says yes and submits.
--
-- stripe_session_id is the Checkout Session id Stripe puts in the redirect
-- URL ({CHECKOUT_SESSION_ID}); Karl matches it to the payment in the Stripe
-- dashboard. One address per session; a resubmit updates it.
--
-- WHO WRITES THIS TABLE: only POST /api/morocco/gift-address, with the service
-- role. RLS on with NO client policies and default grants revoked, same as
-- 097 and 103 — these are home addresses.

create table if not exists public.morocco_gift_addresses (
  id                uuid primary key default gen_random_uuid(),
  stripe_session_id text not null unique
                    check (stripe_session_id ~ '^cs_(live|test)_[A-Za-z0-9]{10,200}$'),
  tier              text check (tier is null or tier in ('10','20','50','100','custom')),
  full_name         text not null check (char_length(full_name) between 1 and 100),
  line1             text not null check (char_length(line1) between 1 and 200),
  line2             text check (line2 is null or char_length(line2) <= 200),
  city              text not null check (char_length(city) between 1 and 100),
  state             text not null check (char_length(state) between 1 and 60),
  postal_code       text not null check (char_length(postal_code) between 2 and 20),
  country           text not null default 'US' check (country in ('US','CA')),
  note              text check (note is null or char_length(note) <= 500),
  mailed_at         timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists morocco_gift_addresses_created_idx
  on public.morocco_gift_addresses (created_at);

alter table public.morocco_gift_addresses enable row level security;
revoke all on table public.morocco_gift_addresses from anon, authenticated;
