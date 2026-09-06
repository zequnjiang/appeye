-- Preserve every historical classification until a user explicitly selects automatic mode.
ALTER TABLE apps ADD COLUMN manual_override INTEGER NOT NULL DEFAULT 0 CHECK(manual_override IN (0,1));
ALTER TABLE apps ADD COLUMN classification_source TEXT NOT NULL DEFAULT 'auto' CHECK(classification_source IN ('auto','manual','legacy'));
ALTER TABLE apps ADD COLUMN loan_analysis TEXT CHECK(loan_analysis IS NULL OR json_valid(loan_analysis));
UPDATE apps SET manual_override=1, classification_source='legacy';

CREATE TABLE jobs_v02 (
  id INTEGER PRIMARY KEY, type TEXT NOT NULL CHECK(type IN ('discover','refresh','reviews','enrich')),
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','succeeded','failed')),
  country TEXT NOT NULL REFERENCES countries(code), store TEXT NOT NULL CHECK(store IN ('google-play','app-store')), app_id INTEGER REFERENCES apps(id),
  dedupe_key TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3,
  progress TEXT, result TEXT, error TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, next_run_at TEXT NOT NULL
);
INSERT INTO jobs_v02 SELECT * FROM jobs;
DROP TABLE jobs;
ALTER TABLE jobs_v02 RENAME TO jobs;
CREATE UNIQUE INDEX jobs_active_unique ON jobs(dedupe_key) WHERE status IN ('queued','running');
CREATE INDEX jobs_queue ON jobs(status,next_run_at);

CREATE TABLE discovery_observations (
  id INTEGER PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id), observed_at TEXT NOT NULL,
  keyword TEXT NOT NULL, request_country TEXT NOT NULL, request_language TEXT NOT NULL,
  source TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data)), raw TEXT NOT NULL CHECK(json_valid(raw))
);
CREATE INDEX discovery_app_time ON discovery_observations(app_id,id DESC);

CREATE TABLE enrichment_history (
  id INTEGER PRIMARY KEY, app_id INTEGER NOT NULL REFERENCES apps(id), kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('available','empty','failed','unsupported')),
  fetched_at TEXT NOT NULL, source TEXT NOT NULL, request_country TEXT, request_language TEXT,
  data TEXT CHECK(data IS NULL OR json_valid(data)), raw TEXT CHECK(raw IS NULL OR json_valid(raw)),
  error TEXT, note TEXT
);
CREATE INDEX enrichment_history_app_kind ON enrichment_history(app_id,kind,id DESC);
CREATE TABLE enrichments (
  app_id INTEGER NOT NULL REFERENCES apps(id), kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('available','empty','failed','unsupported')),
  last_attempt_at TEXT NOT NULL, last_success_at TEXT,
  source TEXT, request_country TEXT, request_language TEXT,
  attempt_source TEXT NOT NULL, attempt_request_country TEXT, attempt_request_language TEXT,
  data TEXT CHECK(data IS NULL OR json_valid(data)), raw TEXT CHECK(raw IS NULL OR json_valid(raw)),
  error TEXT, note TEXT, PRIMARY KEY(app_id,kind)
);
