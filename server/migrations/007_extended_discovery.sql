CREATE TABLE discovery_state (
  id INTEGER PRIMARY KEY CHECK(id=1), next_due_at TEXT, heartbeat_at TEXT
);
INSERT INTO discovery_state(id) VALUES(1);
CREATE TABLE discovery_cycles (
  id INTEGER PRIMARY KEY, due_at TEXT NOT NULL, started_at TEXT NOT NULL,
  finished_at TEXT, status TEXT NOT NULL DEFAULT 'running',
  settings TEXT NOT NULL CHECK(json_valid(settings))
);
CREATE UNIQUE INDEX discovery_one_active ON discovery_cycles(status) WHERE status='running';
CREATE TABLE discovery_markets (
  cycle_id INTEGER NOT NULL REFERENCES discovery_cycles(id), country TEXT NOT NULL, store TEXT NOT NULL,
  source_requests INTEGER NOT NULL DEFAULT 0, detail_requests INTEGER NOT NULL DEFAULT 0,
  last_served INTEGER NOT NULL DEFAULT 0, next_lane TEXT NOT NULL DEFAULT 'source',
  PRIMARY KEY(cycle_id,country,store)
);
CREATE TABLE discovery_rotation (
  country TEXT NOT NULL, store TEXT NOT NULL, source_cursor INTEGER NOT NULL DEFAULT 0,
  last_served INTEGER NOT NULL DEFAULT 0, next_lane TEXT NOT NULL DEFAULT 'source',
  PRIMARY KEY(country,store)
);
CREATE TABLE discovery_frontier (
  id INTEGER PRIMARY KEY, country TEXT NOT NULL, store TEXT NOT NULL, kind TEXT NOT NULL,
  target TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)),
  last_served TEXT, created_at TEXT NOT NULL, consumed INTEGER NOT NULL DEFAULT 0,
  UNIQUE(country,store,kind,target)
);
CREATE INDEX discovery_frontier_rotation ON discovery_frontier(country,store,kind,consumed,last_served,id);
CREATE TABLE discovery_candidates (
  id INTEGER PRIMARY KEY, country TEXT NOT NULL, store TEXT NOT NULL, external_id TEXT NOT NULL,
  title TEXT NOT NULL, app_id INTEGER REFERENCES apps(id), status TEXT NOT NULL DEFAULT 'pending',
  first_observed_at TEXT NOT NULL, last_observed_at TEXT NOT NULL, last_served TEXT, created_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT, analysis TEXT CHECK(analysis IS NULL OR json_valid(analysis)),
  UNIQUE(country,store,external_id)
);
CREATE INDEX discovery_candidate_queue ON discovery_candidates(country,store,status,last_served,id);
CREATE TABLE discovery_tasks (
  id INTEGER PRIMARY KEY, cycle_id INTEGER NOT NULL REFERENCES discovery_cycles(id),
  country TEXT NOT NULL, store TEXT NOT NULL, kind TEXT NOT NULL,
  frontier_id INTEGER REFERENCES discovery_frontier(id), candidate_id INTEGER REFERENCES discovery_candidates(id),
  payload TEXT NOT NULL CHECK(json_valid(payload)), status TEXT NOT NULL DEFAULT 'queued',
  attempts INTEGER NOT NULL DEFAULT 0, response_id INTEGER, applied_response_id INTEGER,
  error TEXT, stop_reason TEXT, created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  UNIQUE(cycle_id,frontier_id), UNIQUE(cycle_id,candidate_id)
);
CREATE INDEX discovery_task_queue ON discovery_tasks(cycle_id,country,store,status,kind,id);
CREATE TABLE discovery_attempts (
  id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES discovery_tasks(id),
  started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL DEFAULT 'running', error TEXT
);
CREATE TABLE discovery_responses (
  id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES discovery_tasks(id),
  attempt_id INTEGER NOT NULL REFERENCES discovery_attempts(id), observed_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE TABLE discovery_http (
  id INTEGER PRIMARY KEY, cycle_id INTEGER NOT NULL, task_id INTEGER NOT NULL,
  fetched_at TEXT NOT NULL, url TEXT NOT NULL, method TEXT NOT NULL, status INTEGER,
  content_type TEXT, body TEXT, error TEXT
);
CREATE INDEX discovery_http_task ON discovery_http(task_id,id);
CREATE TABLE discovery_sources (
  id INTEGER PRIMARY KEY, cycle_id INTEGER, task_id INTEGER, origin_key TEXT NOT NULL,
  country TEXT NOT NULL, store TEXT NOT NULL, external_id TEXT NOT NULL,
  app_id INTEGER REFERENCES apps(id), discovery_id INTEGER, parent_app_id INTEGER REFERENCES apps(id),
  enrichment_history_id INTEGER, kind TEXT NOT NULL, observed_at TEXT NOT NULL, processed_at TEXT NOT NULL,
  source TEXT NOT NULL, request_language TEXT, keyword TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)), raw TEXT NOT NULL CHECK(json_valid(raw)),
  UNIQUE(country,store,external_id,origin_key)
);
CREATE INDEX discovery_sources_identity ON discovery_sources(country,store,external_id,observed_at,id);
CREATE INDEX discovery_sources_task ON discovery_sources(task_id,id);
CREATE INDEX monitor_task_identity ON monitor_tasks(country,store,external_id,id);
