-- 049_rights_takedowns_and_strikes.sql
-- =====================================================================
-- Legal/ops foundation: rights attestations at upload, a real DMCA
-- takedown + counter-notice record, and a repeat-infringer strike ledger.
--
-- WHY THIS EXISTS
--
--   1. §512(c) safe harbour requires a designated agent, a takedown
--      process, and a counter-notice process. None of that had a home in
--      the database — takedowns were an ad-hoc UPDATE on
--      tracks.moderation_status with no record of WHO complained, about
--      WHAT, or WHEN, which is exactly the evidence needed to show the
--      process is real.  17 U.S.C. §512(c)(3), §512(g).
--
--   2. §512(i) conditions the safe harbour on a repeat-infringer policy
--      that is "reasonably implemented". BMG v. Cox (4th Cir. 2018) held
--      a written policy that is not actually enforced forfeits the safe
--      harbour. Enforcement needs a countable strike ledger, so that is
--      what `copyright_strikes` is.
--
--   3. `studio_tracks` — the artist self-upload table, and since
--      migration 046 the SELLABLE one — had NO moderation column at all.
--      `tracks` got one in migration 015, so an admin could take down an
--      admin-curated track but had no lever whatsoever on the artist
--      uploads that are actually for sale. That is the single largest
--      gap here and section 3 closes it.
--
--   4. Uploads carried no record of the uploader's rights basis. Selling
--      a cover requires a mechanical licence (17 U.S.C. §115), and
--      AI-generated audio raises human-authorship (Copyright Office,
--      Copyright and AI Part 2, Jan 2025) and voice-likeness questions.
--      Sections 1-2 record what the uploader asserted, at upload time,
--      as the platform's evidence and the artist's own representation.
--
-- SAFETY / STYLE — matches 015, 041, 046, 048:
--   * ADD COLUMN IF NOT EXISTS / CREATE TABLE IF NOT EXISTS
--   * guarded ALTER ... ADD CONSTRAINT (pg_constraint probe)
--   * CREATE INDEX IF NOT EXISTS, DROP POLICY IF EXISTS + CREATE POLICY
--   * no drops, no rewrites, no data loss; re-running is a no-op
--   * NOT applied to production yet — see docs/legal-ops-runbook.md
--
-- Sections:
--   1. Rights/AI disclosure columns on tracks + studio_tracks
--   2. rights_attestations — the full per-upload attestation record
--   3. Moderation columns on studio_tracks (parity with tracks)
--   4. takedown_notices — DMCA notices and counter-notices
--   5. copyright_strikes — the repeat-infringer ledger
--   6. Helper: active strike count

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Rights basis + AI disclosure, denormalised onto both item tables.
--
--    The authoritative record is `rights_attestations` (section 2), but
--    public pages need to render an "AI-assisted" badge and admin needs
--    to filter "show me every cover" without a join on every row, so the
--    two display-critical fields are mirrored here.
--
--    Defaults are deliberately NULL, not 'original'/'none': NULL means
--    "uploaded before attestation existed / never asked", which is a
--    different and important state from "the artist told us it's
--    original". Back-filling a legal representation the artist never
--    made would manufacture evidence that does not exist.
-- ---------------------------------------------------------------------
ALTER TABLE public.tracks
    ADD COLUMN IF NOT EXISTS rights_basis TEXT,
    ADD COLUMN IF NOT EXISTS ai_disclosure TEXT;

ALTER TABLE public.studio_tracks
    ADD COLUMN IF NOT EXISTS rights_basis TEXT,
    ADD COLUMN IF NOT EXISTS ai_disclosure TEXT;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracks_rights_basis_valid') THEN
        ALTER TABLE public.tracks ADD CONSTRAINT tracks_rights_basis_valid
            CHECK (rights_basis IS NULL OR rights_basis IN
                ('original', 'cover', 'licensed', 'public_domain'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tracks_ai_disclosure_valid') THEN
        ALTER TABLE public.tracks ADD CONSTRAINT tracks_ai_disclosure_valid
            CHECK (ai_disclosure IS NULL OR ai_disclosure IN
                ('none', 'ai_assisted', 'ai_generated'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'studio_tracks_rights_basis_valid') THEN
        ALTER TABLE public.studio_tracks ADD CONSTRAINT studio_tracks_rights_basis_valid
            CHECK (rights_basis IS NULL OR rights_basis IN
                ('original', 'cover', 'licensed', 'public_domain'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'studio_tracks_ai_disclosure_valid') THEN
        ALTER TABLE public.studio_tracks ADD CONSTRAINT studio_tracks_ai_disclosure_valid
            CHECK (ai_disclosure IS NULL OR ai_disclosure IN
                ('none', 'ai_assisted', 'ai_generated'));
    END IF;
END $$;

COMMENT ON COLUMN public.studio_tracks.rights_basis IS
    'Uploader-asserted rights basis. NULL = uploaded before attestation was required; never back-filled, because a representation the artist did not make must not be invented.';
COMMENT ON COLUMN public.studio_tracks.ai_disclosure IS
    'Uploader-asserted generative-AI involvement: none | ai_assisted | ai_generated. Drives the public AI label.';

-- ---------------------------------------------------------------------
-- 2. rights_attestations — one immutable row per upload.
--
--    Polymorphic by (item_type, item_id) rather than two parallel tables
--    because the two upload paths write to different tables
--    (/api/artist/tracks -> public.tracks with an INTEGER id,
--     /api/studio/tracks -> public.studio_tracks with a UUID id) and the
--    review queue has to show them side by side. item_id is TEXT so it
--    can hold either shape; there is deliberately no FK, because the
--    attestation must SURVIVE deletion of the track — it is the evidence
--    that the artist made these representations, and it is most needed
--    precisely when the item has been taken down.
--
--    Append-only by convention: a correction is a new row. The most
--    recent row per item wins (see the index).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rights_attestations (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    item_type                   TEXT NOT NULL,
    item_id                     TEXT NOT NULL,
    profile_id                  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,

    -- What the uploader says the track IS.
    rights_basis                TEXT NOT NULL,
    owns_master                 BOOLEAN NOT NULL DEFAULT FALSE,

    -- Cover-song path (17 U.S.C. §115). A mechanical licence is required
    -- to sell a download of someone else's composition; the platform does
    -- not hold a blanket licence, so the uploader must name theirs.
    cover_work_title            TEXT,
    cover_writers               TEXT,
    mechanical_license_source   TEXT,
    mechanical_license_ref      TEXT,
    cover_unaltered_confirmed   BOOLEAN NOT NULL DEFAULT FALSE,

    -- Generative-AI path.
    ai_disclosure               TEXT NOT NULL DEFAULT 'none',
    ai_tools                    TEXT,
    ai_human_contribution       TEXT,
    ai_commercial_rights        BOOLEAN NOT NULL DEFAULT FALSE,
    no_voice_clone_confirmed    BOOLEAN NOT NULL DEFAULT FALSE,

    -- The attestation itself.
    no_uncleared_samples        BOOLEAN NOT NULL DEFAULT FALSE,
    indemnity_accepted          BOOLEAN NOT NULL DEFAULT FALSE,
    signature                   TEXT,
    terms_version               TEXT,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rights_attestations_item_type_valid') THEN
        ALTER TABLE public.rights_attestations ADD CONSTRAINT rights_attestations_item_type_valid
            CHECK (item_type IN ('track', 'studio_track'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rights_attestations_basis_valid') THEN
        ALTER TABLE public.rights_attestations ADD CONSTRAINT rights_attestations_basis_valid
            CHECK (rights_basis IN ('original', 'cover', 'licensed', 'public_domain'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rights_attestations_ai_valid') THEN
        ALTER TABLE public.rights_attestations ADD CONSTRAINT rights_attestations_ai_valid
            CHECK (ai_disclosure IN ('none', 'ai_assisted', 'ai_generated'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rights_attestations_license_source_valid') THEN
        ALTER TABLE public.rights_attestations ADD CONSTRAINT rights_attestations_license_source_valid
            CHECK (mechanical_license_source IS NULL OR mechanical_license_source IN
                ('hfa_songfile', 'easy_song', 'direct_publisher', 'distributor', 'other'));
    END IF;
    -- A cover offered for sale MUST name a mechanical licence source. This is
    -- the one rule enforced in the database as well as in the API, because it
    -- is the difference between "we asked" and "we required".
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rights_attestations_cover_needs_license') THEN
        ALTER TABLE public.rights_attestations ADD CONSTRAINT rights_attestations_cover_needs_license
            CHECK (
                rights_basis <> 'cover'
                OR (mechanical_license_source IS NOT NULL AND cover_work_title IS NOT NULL)
            );
    END IF;
    -- Anything AI-touched must name the tool AND assert commercial rights in
    -- its output: free-tier output of the major tools is licensed for personal
    -- use only and cannot lawfully be sold here.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rights_attestations_ai_needs_tool') THEN
        ALTER TABLE public.rights_attestations ADD CONSTRAINT rights_attestations_ai_needs_tool
            CHECK (
                ai_disclosure = 'none'
                OR (ai_tools IS NOT NULL AND ai_commercial_rights = TRUE)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS rights_attestations_item_idx
    ON public.rights_attestations (item_type, item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rights_attestations_profile_idx
    ON public.rights_attestations (profile_id, created_at DESC);

ALTER TABLE public.rights_attestations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads own attestations" ON public.rights_attestations;
CREATE POLICY "Owner reads own attestations"
    ON public.rights_attestations FOR SELECT
    USING (profile_id = auth.uid());

COMMENT ON TABLE public.rights_attestations IS
    'Append-only record of what an uploader represented about rights/AI at upload time. Intentionally has no FK to the item: the evidence must outlive a takedown.';

-- ---------------------------------------------------------------------
-- 3. Moderation on studio_tracks — parity with tracks (migration 015).
--
--    Same four states and the same critical property: moderation is a
--    SEPARATE dimension from `status`/publish state, so a takedown never
--    destroys the artist's own draft/published intent and is reversible
--    by flipping one field back to 'clean'.
--
--    Default 'clean' + back-fill is correct here (unlike section 1):
--    this is the platform's own assessment, not a representation being
--    attributed to the artist, and every existing row is in fact live.
-- ---------------------------------------------------------------------
ALTER TABLE public.studio_tracks
    ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'clean',
    ADD COLUMN IF NOT EXISTS moderation_reason TEXT,
    ADD COLUMN IF NOT EXISTS moderated_by UUID REFERENCES public.profiles(id),
    ADD COLUMN IF NOT EXISTS moderated_at TIMESTAMPTZ;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'studio_tracks_moderation_status_valid') THEN
        ALTER TABLE public.studio_tracks ADD CONSTRAINT studio_tracks_moderation_status_valid
            CHECK (moderation_status IN ('clean', 'pending_review', 'flagged', 'removed'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS studio_tracks_moderation_idx
    ON public.studio_tracks (moderation_status);

COMMENT ON COLUMN public.studio_tracks.moderation_status IS
    'Takedown lever for artist self-uploads, independent of publish state. Public reads MUST filter moderation_status = ''clean''. removed = taken down, one field away from reinstatement.';

-- ---------------------------------------------------------------------
-- 4. takedown_notices — DMCA notices, counter-notices, and NIL claims.
--
--    One table for both directions, linked by `parent_id`, because a
--    counter-notice is only ever meaningful in relation to the notice it
--    answers, and the §512(g) clock runs between the two.
--
--    The `restore_not_before` / `restore_not_after` pair is the §512(g)
--    window: after forwarding a counter-notice to the complainant the
--    platform must restore the material in not less than 10 and not more
--    than 14 business days, UNLESS the complainant says it has filed
--    suit (`lawsuit_notified_at`). Business days are computed in the app,
--    not here, so a single holiday calendar lives in one place.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.takedown_notices (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reference               TEXT UNIQUE,          -- human-quotable case id
    kind                    TEXT NOT NULL DEFAULT 'dmca',
    status                  TEXT NOT NULL DEFAULT 'received',
    parent_id               UUID REFERENCES public.takedown_notices(id) ON DELETE SET NULL,

    -- Who is complaining (§512(c)(3)(A)(iv)).
    claimant_name           TEXT NOT NULL,
    claimant_email          TEXT NOT NULL,
    claimant_phone          TEXT,
    claimant_address        TEXT,
    claimant_organization   TEXT,
    on_behalf_of            TEXT,                 -- rights holder, if agent

    -- What is claimed (§512(c)(3)(A)(ii)-(iii)).
    work_description        TEXT NOT NULL,
    infringing_urls         TEXT[] NOT NULL DEFAULT '{}',
    target_type             TEXT,                 -- track | studio_track | video | social_video | profile | other
    target_id               TEXT,

    -- The sworn elements (§512(c)(3)(A)(v)-(vi), §512(g)(3)).
    good_faith_statement    BOOLEAN NOT NULL DEFAULT FALSE,
    accuracy_statement      BOOLEAN NOT NULL DEFAULT FALSE,
    authority_statement     BOOLEAN NOT NULL DEFAULT FALSE,
    jurisdiction_consent    BOOLEAN NOT NULL DEFAULT FALSE,  -- counter-notice only
    service_acceptance      BOOLEAN NOT NULL DEFAULT FALSE,  -- counter-notice only
    signature               TEXT NOT NULL,

    -- Handling trail.
    submitted_by            UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    uploader_profile_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    uploader_notified_at    TIMESTAMPTZ,
    forwarded_at            TIMESTAMPTZ,
    restore_not_before      TIMESTAMPTZ,
    restore_not_after       TIMESTAMPTZ,
    lawsuit_notified_at     TIMESTAMPTZ,
    actioned_at             TIMESTAMPTZ,
    actioned_by             UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    resolution_note         TEXT,
    source_ip               TEXT,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'takedown_notices_kind_valid') THEN
        ALTER TABLE public.takedown_notices ADD CONSTRAINT takedown_notices_kind_valid
            CHECK (kind IN ('dmca', 'counter_notice', 'voice_likeness', 'trademark', 'other'));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'takedown_notices_status_valid') THEN
        ALTER TABLE public.takedown_notices ADD CONSTRAINT takedown_notices_status_valid
            CHECK (status IN (
                'received',        -- logged, not yet triaged
                'incomplete',      -- missing a §512(c)(3) element; sender asked to cure
                'under_review',
                'content_removed', -- acted on: material disabled
                'rejected',        -- not actionable
                'withdrawn',
                'counter_pending', -- counter-notice forwarded, §512(g) clock running
                'reinstated'
            ));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'takedown_notices_target_type_valid') THEN
        ALTER TABLE public.takedown_notices ADD CONSTRAINT takedown_notices_target_type_valid
            CHECK (target_type IS NULL OR target_type IN
                ('track', 'studio_track', 'video', 'social_video', 'profile', 'other'));
    END IF;
    -- A counter-notice without jurisdiction consent + acceptance of service is
    -- not a counter-notice under §512(g)(3)(D) and must not be storable as one.
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'takedown_notices_counter_requires_consent') THEN
        ALTER TABLE public.takedown_notices ADD CONSTRAINT takedown_notices_counter_requires_consent
            CHECK (
                kind <> 'counter_notice'
                OR (jurisdiction_consent = TRUE AND service_acceptance = TRUE)
            );
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS takedown_notices_status_idx
    ON public.takedown_notices (status, created_at DESC);
CREATE INDEX IF NOT EXISTS takedown_notices_target_idx
    ON public.takedown_notices (target_type, target_id);
CREATE INDEX IF NOT EXISTS takedown_notices_uploader_idx
    ON public.takedown_notices (uploader_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS takedown_notices_parent_idx
    ON public.takedown_notices (parent_id);

-- Admin-only by default: no SELECT policy is granted to authenticated users.
-- The app reads these with the service-role client behind requireAdmin().
ALTER TABLE public.takedown_notices ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.takedown_notices IS
    'DMCA notices and §512(g) counter-notices. RLS denies all non-service-role access: notices contain complainant home addresses and phone numbers.';

-- ---------------------------------------------------------------------
-- 5. copyright_strikes — the §512(i) repeat-infringer ledger.
--
--    A strike is issued only when a notice is actually acted on, and it
--    EXPIRES (default 12 months) so the policy is graduated rather than
--    permanent. `voided_at` records a strike withdrawn because the
--    material was reinstated after a counter-notice — reinstatement that
--    left the strike standing would make the count dishonest.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.copyright_strikes (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    profile_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    notice_id       UUID REFERENCES public.takedown_notices(id) ON DELETE SET NULL,
    reason          TEXT NOT NULL,
    item_type       TEXT,
    item_id         TEXT,
    issued_by       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '12 months'),
    voided_at       TIMESTAMPTZ,
    voided_reason   TEXT
);

CREATE INDEX IF NOT EXISTS copyright_strikes_profile_idx
    ON public.copyright_strikes (profile_id, issued_at DESC);

-- One strike per acted-on notice: re-running the "remove + strike" action
-- must not inflate an artist's count.
CREATE UNIQUE INDEX IF NOT EXISTS copyright_strikes_notice_uniq
    ON public.copyright_strikes (notice_id)
    WHERE notice_id IS NOT NULL;

ALTER TABLE public.copyright_strikes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owner reads own strikes" ON public.copyright_strikes;
CREATE POLICY "Owner reads own strikes"
    ON public.copyright_strikes FOR SELECT
    USING (profile_id = auth.uid());

COMMENT ON TABLE public.copyright_strikes IS
    'Repeat-infringer ledger backing the §512(i) policy. Strikes expire after 12 months and are voided on reinstatement so the count stays honest.';

-- ---------------------------------------------------------------------
-- 6. Helper: how many strikes count against an account right now.
--    STABLE + explicit search_path (advisor 0011), same as 015.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.active_strike_count(p_profile_id UUID)
RETURNS INTEGER
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = ''
AS $fn$
    SELECT COUNT(*)::INTEGER
    FROM public.copyright_strikes s
    WHERE s.profile_id = p_profile_id
      AND s.voided_at IS NULL
      AND s.expires_at > now();
$fn$;

COMMENT ON FUNCTION public.active_strike_count(UUID) IS
    'Unexpired, unvoided strikes for a profile. Three is the documented termination threshold (see /legal/copyright).';

COMMIT;
