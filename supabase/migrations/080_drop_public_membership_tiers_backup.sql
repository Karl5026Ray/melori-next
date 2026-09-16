-- RECOVERED 080_drop_public_membership_tiers_backup
--
-- This file was missing from supabase/migrations/ while the migration was
-- already applied to production. The SQL below is the exact text recorded in
-- supabase_migrations.schema_migrations for version 20260915143720, recovered
-- verbatim -- it is not a reconstruction from the live schema.
--
-- Already applied. Do not re-apply. See scripts/migration-prefix.test.ts for
-- the gap check that now makes this class of drift fail CI.

-- Drop the leftover membership-tiers backup table.
--
-- public._backup_membership_tiers_20260908 was a snapshot taken when paid tiers
-- were removed from Melori. It sat in the `public` schema with row level
-- security switched OFF and no policies, which meant its contents - including
-- live Stripe payment links - were readable by anyone holding the project's
-- publishable API key. It was the only CRITICAL finding on the security
-- advisor.
--
-- Paid tiers are gone from the product (requireSuperfan / requireArtist are
-- now aliases for requireAuth), so the snapshot has no remaining use. Its four
-- rows were exported before this ran.
--
-- Note this drops only the BACKUP. public.membership_tiers - the live table,
-- currently empty - is left in place deliberately: migration 069_snappd_role
-- writes to it, so dropping it would break a migration replay from scratch.

drop table if exists public._backup_membership_tiers_20260908;
