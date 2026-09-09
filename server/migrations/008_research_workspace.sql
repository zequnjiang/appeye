-- Public market facts remain untouched; customer research has explicit workspace ownership.
CREATE TABLE research_workspaces (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE research_users (
 id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)), created_at TEXT NOT NULL
);
CREATE TABLE research_memberships (
 workspace_id INTEGER NOT NULL REFERENCES research_workspaces(id), user_id INTEGER NOT NULL REFERENCES research_users(id),
 role TEXT NOT NULL CHECK(role IN ('admin','researcher','viewer')), enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 updated_at TEXT NOT NULL, PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE research_sessions (
 token_hash TEXT PRIMARY KEY, user_id INTEGER REFERENCES research_users(id), workspace_id INTEGER REFERENCES research_workspaces(id),
 platform_auth TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 CHECK((user_id IS NULL AND workspace_id IS NULL AND platform_auth IS NOT NULL) OR (user_id IS NOT NULL AND workspace_id IS NOT NULL AND platform_auth IS NULL))
);
CREATE INDEX research_sessions_expiry ON research_sessions(expires_at);
CREATE TABLE research_invitations (
 id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES research_workspaces(id), email TEXT NOT NULL COLLATE NOCASE,
 role TEXT NOT NULL CHECK(role IN ('admin','researcher','viewer')), token_hash TEXT NOT NULL UNIQUE,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','revoked')), expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
 accepted_at TEXT, created_by INTEGER NOT NULL
);
CREATE TABLE research_groups (
 id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES research_workspaces(id), name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE research_favorites (
 workspace_id INTEGER NOT NULL REFERENCES research_workspaces(id), app_id INTEGER NOT NULL REFERENCES apps(id),
 group_id INTEGER REFERENCES research_groups(id) ON DELETE SET NULL, created_at TEXT NOT NULL, PRIMARY KEY(workspace_id,app_id)
);
CREATE TABLE research_collections (
 id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES research_workspaces(id), name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE research_collection_apps (
 collection_id INTEGER NOT NULL REFERENCES research_collections(id) ON DELETE CASCADE, app_id INTEGER NOT NULL REFERENCES apps(id), PRIMARY KEY(collection_id,app_id)
);
CREATE TABLE research_entries (
 id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES research_workspaces(id), app_id INTEGER NOT NULL REFERENCES apps(id),
 collection_id INTEGER REFERENCES research_collections(id) ON DELETE SET NULL, kind TEXT NOT NULL CHECK(kind IN ('note','excerpt')),
 text TEXT NOT NULL, app_identity TEXT NOT NULL CHECK(json_valid(app_identity)), revision INTEGER NOT NULL DEFAULT 1, citation TEXT CHECK(citation IS NULL OR json_valid(citation)), created_by INTEGER NOT NULL REFERENCES research_users(id),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX research_entries_scope ON research_entries(workspace_id,collection_id,id);
CREATE TABLE research_reads (
 workspace_id INTEGER NOT NULL REFERENCES research_workspaces(id), user_id INTEGER NOT NULL REFERENCES research_users(id),
 event_id TEXT NOT NULL, read_at TEXT NOT NULL, PRIMARY KEY(workspace_id,user_id,event_id)
);
CREATE TABLE research_requests (
 id INTEGER PRIMARY KEY, workspace_id INTEGER NOT NULL REFERENCES research_workspaces(id), requested_by INTEGER NOT NULL REFERENCES research_users(id),
 country TEXT NOT NULL REFERENCES countries(code), store TEXT NOT NULL CHECK(store IN ('google-play','app-store')), external_id TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','admitted','failed','rejected','review')),
 app_id INTEGER REFERENCES apps(id), job_id INTEGER REFERENCES jobs(id), error TEXT, note TEXT, result_observed_at TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(workspace_id,country,store,external_id)
);
CREATE TABLE research_app_categories (
 app_id INTEGER PRIMARY KEY REFERENCES apps(id), category TEXT NOT NULL CHECK(category IN ('personal','other','unknown')), reason TEXT NOT NULL,
 updated_by INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE research_audit (
 id INTEGER PRIMARY KEY, actor_id INTEGER NOT NULL, workspace_id INTEGER, action TEXT NOT NULL, target_id TEXT, detail TEXT NOT NULL CHECK(json_valid(detail)), created_at TEXT NOT NULL
);
CREATE TABLE research_query_snapshots (
 id TEXT PRIMARY KEY, session_hash TEXT NOT NULL REFERENCES research_sessions(token_hash) ON DELETE CASCADE,
 query TEXT NOT NULL CHECK(json_valid(query)), revision TEXT NOT NULL, rows TEXT NOT NULL CHECK(json_valid(rows)), created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE INDEX research_query_session ON research_query_snapshots(session_hash,created_at);
CREATE TABLE research_rule_config (
 id INTEGER PRIMARY KEY CHECK(id=1), auto_confirm_strong INTEGER NOT NULL DEFAULT 1 CHECK(auto_confirm_strong IN (0,1)), version INTEGER NOT NULL, updated_at TEXT NOT NULL
);
INSERT INTO research_rule_config VALUES (1,1,1,strftime('%Y-%m-%dT%H:%M:%fZ','now'));
