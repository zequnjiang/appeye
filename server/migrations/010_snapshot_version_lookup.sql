-- Keep observed version history in index pages rather than rereading every
-- full source snapshot whenever the collector or a detail page loads an app.
CREATE INDEX snapshots_app_version_time
ON snapshots(app_id,observed_at,id,json_extract(data,'$.version'))
WHERE json_extract(data,'$.version') IS NOT NULL;
