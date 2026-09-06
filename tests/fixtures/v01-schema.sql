-- Frozen V0.1 schema for synthetic migration tests. Never points at a real database.
CREATE TABLE schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL);

-- 001_initial.sql
CREATE TABLE IF NOT EXISTS countries (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, language TEXT NOT NULL, keywords TEXT NOT NULL CHECK(json_valid(keywords)),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), interval_hours REAL NOT NULL DEFAULT 24 CHECK(interval_hours >= 1),
  last_discovery_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY, store TEXT NOT NULL CHECK(store IN ('google-play','app-store')), external_id TEXT NOT NULL,
  country TEXT NOT NULL REFERENCES countries(code), classification TEXT NOT NULL DEFAULT 'candidate' CHECK(classification IN ('candidate','confirmed','excluded')),
  title TEXT NOT NULL, developer TEXT, source_keyword TEXT, data TEXT NOT NULL CHECK(json_valid(data)),
  first_seen_at TEXT NOT NULL, last_seen_at TEXT NOT NULL, last_fetched_at TEXT, last_error TEXT,
  UNIQUE(store, external_id, country)
);
CREATE INDEX IF NOT EXISTS apps_country_classification ON apps(country,classification);
CREATE TABLE IF NOT EXISTS snapshots (id INTEGER PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id), observed_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), raw TEXT NOT NULL CHECK(json_valid(raw)));
CREATE INDEX IF NOT EXISTS snapshots_app_time ON snapshots(app_id,observed_at DESC);
CREATE TABLE IF NOT EXISTS changes (id INTEGER PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id), field TEXT NOT NULL, old_value TEXT NOT NULL, new_value TEXT NOT NULL, observed_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS changes_app_time ON changes(app_id,observed_at DESC);
CREATE INDEX IF NOT EXISTS changes_time ON changes(observed_at DESC);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id), external_id TEXT NOT NULL, country TEXT NOT NULL,
  language TEXT NOT NULL, user_name TEXT, title TEXT, text TEXT NOT NULL, score REAL, version TEXT, reviewed_at TEXT, reply_text TEXT,
  fetched_at TEXT NOT NULL, raw TEXT NOT NULL CHECK(json_valid(raw)), UNIQUE(app_id, external_id, country, language)
);
CREATE INDEX IF NOT EXISTS reviews_app_time ON reviews(app_id,reviewed_at DESC);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('discover','refresh','reviews')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed')),
  country TEXT NOT NULL REFERENCES countries(code), store TEXT NOT NULL CHECK(store IN ('google-play','app-store')), app_id INTEGER REFERENCES apps(id),
  dedupe_key TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
  progress TEXT, result TEXT, error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, next_run_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_unique ON jobs(dedupe_key) WHERE status IN ('queued','running');
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs(status,next_run_at);
CREATE TABLE IF NOT EXISTS schedule_state (country TEXT NOT NULL REFERENCES countries(code), store TEXT NOT NULL, last_scheduled_at TEXT NOT NULL, PRIMARY KEY(country,store));

INSERT INTO schema_migrations VALUES ('001_initial.sql','2026-01-01T00:00:00.000Z');

-- 002_dataset.sql
CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);

INSERT INTO schema_migrations VALUES ('002_dataset.sql','2026-01-01T00:00:00.000Z');

-- 003_change_snapshot.sql
ALTER TABLE changes ADD COLUMN snapshot_id INTEGER REFERENCES snapshots(id);

INSERT INTO schema_migrations VALUES ('003_change_snapshot.sql','2026-01-01T00:00:00.000Z');

-- 004_review_identity.sql
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

INSERT INTO schema_migrations VALUES ('004_review_identity.sql','2026-01-01T00:00:00.000Z');
