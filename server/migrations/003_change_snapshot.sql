ALTER TABLE changes ADD COLUMN snapshot_id INTEGER REFERENCES snapshots(id);
