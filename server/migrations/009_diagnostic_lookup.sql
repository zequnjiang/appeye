-- Diagnostic task IDs are selected before their payloads are read.
CREATE INDEX discovery_tasks_candidate_market ON discovery_tasks(candidate_id,country,store,id);
CREATE INDEX discovery_sources_identity_task ON discovery_sources(country,store,external_id,task_id);
