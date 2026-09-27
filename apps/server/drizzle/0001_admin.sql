CREATE TABLE sessions (secret_hash TEXT PRIMARY KEY NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE auth_limits (key TEXT PRIMARY KEY NOT NULL, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
--> statement-breakpoint
ALTER TABLE requests ADD COLUMN headers TEXT NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE INDEX requests_filter_idx ON requests(resource_slug, ts);
--> statement-breakpoint
CREATE INDEX requests_token_idx ON requests(token_id, ts);
