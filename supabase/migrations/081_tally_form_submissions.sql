-- 081_tally_form_submissions
--
-- Receives Tally webhook submissions (WOE first-look, Melori waitlist, paid
-- checkout, casting) into a single event log, with UTM attribution broken out
-- into real columns so we can answer "which post drove this signup?".
--
-- Design notes:
--   * form_submissions is an EVENT log. One row per submission. A person who
--     fills two forms gets two rows -- that is correct, not a duplicate.
--   * contact_signups stays the deduplicated PERSON list. The webhook merges
--     into it through upsert_contact_signup() so that a later submission can
--     never blank out a name we already have, and can never revoke an email
--     consent that was previously granted.
--   * RLS is ON with no policies on form_submissions: service-role only. The
--     webhook runs with getSupabaseAdmin(), which bypasses RLS. Nothing
--     anon/authenticated can read a table holding lead emails.
--
-- Index shapes are load-bearing, not cosmetic: PostgREST's `on_conflict=`
-- names plain columns, and Postgres will not infer a PARTIAL or EXPRESSION
-- unique index from a bare column list. A partial/expression index here makes
-- every upsert fail with SQLSTATE 42P10. Keep these indexes plain.

create table if not exists public.form_submissions (
  id              uuid primary key default gen_random_uuid(),

  -- Tally identifiers. submission_id is what we dedupe on.
  event_id        text,
  submission_id   text,
  respondent_id   text,
  form_id         text not null,
  form_name       text,

  -- Which funnel this belongs to. Drives follow-up routing.
  form_type       text not null
                  check (form_type in (
                    'woe_first_look',
                    'melori_waitlist',
                    'purchase',
                    'casting',
                    'other'
                  )),

  -- For woe_first_look: separates a curious reader from a money conversation.
  audience_segment text,

  -- Person
  email           text,
  name            text,
  phone           text,

  -- Attribution. Populated from Tally hidden fields, which Tally fills from
  -- the query string on the embedding page.
  utm_source      text,
  utm_medium      text,
  utm_campaign    text,
  utm_content     text,
  utm_term        text,
  referrer        text,
  landing_path    text,

  -- Money, for 'purchase' rows. Integer cents, never float.
  amount_cents    integer,
  currency        text,

  -- Everything Tally sent, verbatim. Never lose data we did not model yet.
  payload         jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now()
);

-- Tally retries a webhook up to 5 times (5min, 30min, 1hr, 6hr, 1day) and its
-- endpoint timeout is 10s. A handler that succeeds slowly still gets retried,
-- so without this the same submission lands twice.
--
-- NOT partial: NULLs never conflict with each other in a btree unique index,
-- so rows with a null submission_id are already unconstrained. Adding
-- `where submission_id is not null` would buy nothing and would break
-- `on_conflict=submission_id` inference.
create unique index if not exists form_submissions_submission_id_key
  on public.form_submissions (submission_id);

-- "Show me this week's waitlist signups" / per-funnel dashboards.
create index if not exists form_submissions_type_created_idx
  on public.form_submissions (form_type, created_at desc);

-- "Has this person been in before?" The route lowercases email before write,
-- so a plain column index is enough and keeps lookups trivial.
create index if not exists form_submissions_email_idx
  on public.form_submissions (email)
  where email is not null;

-- "Which campaign is actually working?"
create index if not exists form_submissions_attribution_idx
  on public.form_submissions (utm_source, utm_campaign, created_at desc)
  where utm_source is not null;

alter table public.form_submissions enable row level security;

-- Deliberately no policies. Service role only.
revoke all on public.form_submissions from anon, authenticated;

comment on table public.form_submissions is
  'Tally webhook intake. Event log, one row per submission. Service-role access only.';


-- ---------------------------------------------------------------------------
-- contact_signups: one row per person.
-- ---------------------------------------------------------------------------

-- Normalize before adding the unique index, or a legacy mixed-case row
-- collides with a new lowercased one and we get two rows for one person.
update public.contact_signups
   set email = lower(btrim(email))
 where email is not null
   and email <> lower(btrim(email));

-- Plain column, not lower(email), and not partial -- see the note at the top.
-- The write paths are responsible for lowercasing.
create unique index if not exists contact_signups_email_key
  on public.contact_signups (email);


-- ---------------------------------------------------------------------------
-- upsert_contact_signup: merge a person without destroying what we know.
-- ---------------------------------------------------------------------------
-- A plain PostgREST upsert sets every column in the payload, so a returning
-- contact who fills a form with no name field, or no consent checkbox, would
-- blank their name and silently revoke their email consent. Both are bugs with
-- real-world cost: the second one un-subscribes people we are allowed to mail.
--
-- Rules encoded here:
--   * name/phone: keep the existing value unless we were handed a better one.
--   * consent_email: latches ON. Consent is granted by an opt-in and revoked
--     only by an unsubscribe flow -- never by the absence of a checkbox.
--   * source: first-touch wins. That is the attribution question worth asking.

create or replace function public.upsert_contact_signup(
  p_email   text,
  p_name    text default null,
  p_phone   text default null,
  p_consent boolean default false,
  p_source  text default null
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_email text := nullif(lower(btrim(p_email)), '');
begin
  if v_email is null then
    return;
  end if;

  insert into public.contact_signups (email, name, phone, consent_email, source)
  values (
    v_email,
    nullif(btrim(p_name), ''),
    nullif(btrim(p_phone), ''),
    coalesce(p_consent, false),
    coalesce(nullif(btrim(p_source), ''), 'free_tier')
  )
  on conflict (email) do update
    set name          = coalesce(nullif(btrim(excluded.name), ''),
                                 public.contact_signups.name),
        phone         = coalesce(nullif(btrim(excluded.phone), ''),
                                 public.contact_signups.phone),
        consent_email = coalesce(public.contact_signups.consent_email, false)
                        or coalesce(excluded.consent_email, false),
        source        = coalesce(public.contact_signups.source, excluded.source);
end;
$$;

revoke all on function public.upsert_contact_signup(text, text, text, boolean, text)
  from public, anon, authenticated;
grant execute on function public.upsert_contact_signup(text, text, text, boolean, text)
  to service_role;

comment on function public.upsert_contact_signup(text, text, text, boolean, text) is
  'Merge a contact without clobbering: name/phone coalesce, consent latches on, source is first-touch. Service-role only.';
