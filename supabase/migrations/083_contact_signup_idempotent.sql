-- 083_contact_signup_idempotent
--
-- Fixes a regression introduced by 081.
--
-- 081 added a unique index on contact_signups(email) so the Tally webhook
-- could upsert. But /api/contact-signup -- the site's own signup form, which
-- predates all of this -- does a plain .insert(). Before 081 a returning
-- visitor silently created a duplicate row; after 081 they get SQLSTATE 23505
-- and the route hands the raw Postgres message back to the browser. Verified
-- against production before writing this.
--
-- The fix is to give that route the same merge path the webhook uses, which
-- also makes it idempotent and removes the duplicate rows it used to create.
-- That route carries consent_sms, which the 5-arg form had no slot for, so the
-- function grows one parameter.
--
-- DROP then CREATE rather than adding an overload: two overloads where the
-- extra parameter is defaulted makes a 5-named-argument PostgREST call
-- ambiguous, which would break the webhook that is already deployed and
-- calling it. One function, one signature. Both statements run in this
-- migration's transaction, so there is no window where the function is
-- missing, and the deployed webhook keeps resolving -- it passes five named
-- arguments and the sixth defaults.

drop function if exists public.upsert_contact_signup(text, text, text, boolean, text);

create function public.upsert_contact_signup(
  p_email       text,
  p_name        text default null,
  p_phone       text default null,
  p_consent     boolean default false,
  p_source      text default null,
  p_consent_sms boolean default false
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

  insert into public.contact_signups (
    email, name, phone, consent_email, consent_sms, source
  )
  values (
    v_email,
    nullif(btrim(p_name), ''),
    nullif(btrim(p_phone), ''),
    coalesce(p_consent, false),
    coalesce(p_consent_sms, false),
    coalesce(nullif(btrim(p_source), ''), 'free_tier')
  )
  on conflict (email) do update
    set name          = coalesce(nullif(btrim(excluded.name), ''),
                                 public.contact_signups.name),
        phone         = coalesce(nullif(btrim(excluded.phone), ''),
                                 public.contact_signups.phone),
        -- Both consents latch ON. Consent is granted by an opt-in and revoked
        -- only by an unsubscribe flow, never by the absence of a checkbox on
        -- some later form.
        consent_email = coalesce(public.contact_signups.consent_email, false)
                        or coalesce(excluded.consent_email, false),
        consent_sms   = coalesce(public.contact_signups.consent_sms, false)
                        or coalesce(excluded.consent_sms, false),
        -- First touch wins: that is the attribution question worth asking.
        source        = coalesce(public.contact_signups.source, excluded.source);
end;
$$;

revoke all on function
  public.upsert_contact_signup(text, text, text, boolean, text, boolean)
  from public, anon, authenticated;
grant execute on function
  public.upsert_contact_signup(text, text, text, boolean, text, boolean)
  to service_role;

comment on function
  public.upsert_contact_signup(text, text, text, boolean, text, boolean) is
  'Single merge path for every contact write (Tally webhook and /api/contact-signup): name/phone coalesce, both consents latch on, source is first-touch. Idempotent. Service-role only.';
