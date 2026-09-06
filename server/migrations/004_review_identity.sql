-- Stable store review IDs belong to the tracked app, regardless of requested language.
-- Keep the most recently fetched representation when upgrading databases with duplicates.
DELETE FROM reviews WHERE id IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY app_id, external_id ORDER BY fetched_at DESC, id DESC
    ) AS position FROM reviews
  ) WHERE position > 1
);
CREATE UNIQUE INDEX IF NOT EXISTS reviews_stable_identity ON reviews(app_id,external_id);
