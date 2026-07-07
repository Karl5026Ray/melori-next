-- Migration 013: add sort_order for track ordering within an album.
--
-- Why: studio_tracks has a free-text `album` column but no way to order
-- tracks within an album. Legacy `tracks` uses `track_number`; the new
-- pattern here is `sort_order` scoped by (owner_id, album). NULL means
-- unpositioned (sort last, stable by created_at fallback).
--
-- Backfill assigns 1..N per (owner_id, album) partition, ordered by
-- created_at ascending so existing albums keep their upload order.

ALTER TABLE studio_tracks
  ADD COLUMN IF NOT EXISTS sort_order INTEGER;

-- Backfill: assign sort_order = row_number within each (owner_id, album)
-- partition, ordered by created_at. Runs once; safe to re-run because it
-- overwrites all rows (idempotent for this specific ordering).
WITH ordered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY owner_id, COALESCE(album, '')
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM studio_tracks
)
UPDATE studio_tracks t
SET sort_order = o.rn
FROM ordered o
WHERE t.id = o.id
  AND t.sort_order IS NULL;

-- Index used by the studio list query (ORDER BY sort_order per album)
-- and by the reorder endpoint's "max sort_order for album" lookup.
CREATE INDEX IF NOT EXISTS idx_studio_tracks_owner_album_order
  ON studio_tracks (owner_id, album, sort_order);
