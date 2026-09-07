-- The user requested a uniform hourly cycle; preserve all other country preferences.
UPDATE countries SET interval_hours=1;
CREATE TABLE monitor_state (id INTEGER PRIMARY KEY CHECK(id=1), next_due_at TEXT, heartbeat_at TEXT);
INSERT INTO monitor_state(id) VALUES(1);
CREATE TABLE monitor_cycles (
  id INTEGER PRIMARY KEY, due_at TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running', countries TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(countries))
);
CREATE UNIQUE INDEX monitor_one_active_cycle ON monitor_cycles(status) WHERE status='running';
CREATE TABLE monitor_tasks (
  id INTEGER PRIMARY KEY, cycle_id INTEGER NOT NULL REFERENCES monitor_cycles(id), task_key TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('list','search','detail')), country TEXT NOT NULL, store TEXT NOT NULL,
  external_id TEXT, app_id INTEGER REFERENCES apps(id), payload TEXT NOT NULL CHECK(json_valid(payload)),
  status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, next_run_at TEXT NOT NULL,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, response_id INTEGER, applied_response_id INTEGER,
  error TEXT, result TEXT CHECK(result IS NULL OR json_valid(result)), UNIQUE(cycle_id,task_key)
);
CREATE INDEX monitor_queue ON monitor_tasks(status,next_run_at,id);
CREATE INDEX monitor_cycle_status ON monitor_tasks(cycle_id,status);
CREATE TABLE monitor_attempts (
  id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES monitor_tasks(id), attempt INTEGER NOT NULL,
  started_at TEXT NOT NULL, finished_at TEXT, status TEXT NOT NULL, error TEXT
);
CREATE TABLE monitor_responses (
  id INTEGER PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES monitor_tasks(id), attempt_id INTEGER NOT NULL,
  observed_at TEXT NOT NULL, data TEXT NOT NULL CHECK(json_valid(data))
);
CREATE TABLE monitor_http (
  id INTEGER PRIMARY KEY, cycle_id INTEGER REFERENCES monitor_cycles(id), task_id INTEGER REFERENCES monitor_tasks(id),
  job_id INTEGER REFERENCES jobs(id), fetched_at TEXT NOT NULL, url TEXT NOT NULL, method TEXT NOT NULL,
  status INTEGER, content_type TEXT, body TEXT, error TEXT
);
CREATE INDEX monitor_http_task ON monitor_http(task_id,id);
CREATE TABLE monitor_sources (
  id INTEGER PRIMARY KEY, cycle_id INTEGER NOT NULL, task_id INTEGER NOT NULL, country TEXT NOT NULL,
  store TEXT NOT NULL, external_id TEXT NOT NULL, app_id INTEGER REFERENCES apps(id), discovery_id INTEGER,
  observed_at TEXT NOT NULL, source TEXT NOT NULL, keyword TEXT NOT NULL, request_language TEXT,
  data TEXT NOT NULL CHECK(json_valid(data)), raw TEXT NOT NULL CHECK(json_valid(raw)),
  UNIQUE(task_id,external_id)
);
CREATE INDEX monitor_sources_identity ON monitor_sources(cycle_id,country,store,external_id);
CREATE INDEX apps_first_seen ON apps(first_seen_at,id);
CREATE INDEX monitor_sources_first_seen ON monitor_sources(country,store,external_id,observed_at);
CREATE TABLE manual_responses (
  id INTEGER PRIMARY KEY, job_id INTEGER NOT NULL REFERENCES jobs(id), job_attempt INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('app','reviews','enrich')), app_id INTEGER NOT NULL REFERENCES apps(id),
  country TEXT NOT NULL, store TEXT NOT NULL, request_language TEXT,
  response_key TEXT NOT NULL, observed_at TEXT NOT NULL,
  data TEXT NOT NULL CHECK(json_valid(data)), applied_at TEXT,
  UNIQUE(job_id,response_key)
);
CREATE INDEX manual_responses_app_time ON manual_responses(app_id,kind,observed_at,id);
CREATE INDEX monitor_http_job ON monitor_http(job_id,id);
