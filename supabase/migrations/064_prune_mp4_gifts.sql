-- 064_prune_mp4_gifts.sql
-- Retire the 13 legacy MP4 gifts seeded in migration 058 in favor of the
-- newer GLB-based catalog (see migration 063).
--
-- IMPORTANT: We soft-deactivate rather than hard-delete. `public.gift_sends`
-- references `public.gifts(id)` with the default ON DELETE NO ACTION behavior
-- (see migration 058), so any gift that has ever been sent cannot be deleted
-- without raising a foreign-key violation and aborting this migration. Setting
-- `active = false` removes the gifts from the purchasable catalog (the app and
-- RLS policies filter on `active = true`) while preserving the gift_sends
-- ledger history that still references these ids.
update public.gifts
set active = false
where id in (
  '1ce14328-89e9-447f-881e-64539c074b5c',
  '925882e0-354b-483d-9143-a4cca10cc9aa',
  'e016f867-3d39-4ce2-b47b-43c90c04dd6b',
  '891e6237-6b04-4c1c-a107-b25f43dd8389',
  '5e2b21ee-54d4-4cc7-a055-ffb945ecfc99',
  'abe9be6d-d3bb-4cbf-b56d-3cf55f1b6f25',
  '154c0a5b-3d8e-483f-946a-40785471acd7',
  '18b67955-95d9-4142-bcd6-2731b4727d09',
  'baff2e2b-9c52-4768-a3c8-47d2b21eba82',
  '7fe7ed05-0abc-444b-b166-14e311a03fe3',
  '5da47486-c1af-40ad-8322-aaa054dc5977',
  '95e9e187-e93e-496d-845b-bacfaf70d8ee',
  'c86f915b-d171-43c6-803f-4178659ed6c7'
);
