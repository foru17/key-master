CREATE TABLE resources (id TEXT PRIMARY KEY NOT NULL, slug TEXT NOT NULL UNIQUE, kind TEXT NOT NULL CHECK(kind IN ('file','inline','upstream')), source TEXT NOT NULL, content_type TEXT NOT NULL, policy TEXT NOT NULL CHECK(policy IN ('token_only','approval','public')), enabled INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE tokens (id TEXT PRIMARY KEY NOT NULL, label TEXT NOT NULL, secret_hash TEXT NOT NULL, scope TEXT NOT NULL CHECK(json_valid(scope)), kind TEXT NOT NULL CHECK(kind IN ('machine','device')), expires_at INTEGER, last_used_at INTEGER, revoked_at INTEGER, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE grants (id TEXT PRIMARY KEY NOT NULL, subject_kind TEXT NOT NULL CHECK(subject_kind IN ('ip','ip_client')), subject TEXT NOT NULL, scope TEXT NOT NULL CHECK(json_valid(scope)), granted_by TEXT NOT NULL, expires_at INTEGER NOT NULL, revoked_at INTEGER, created_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX grants_subject_idx ON grants(subject);
--> statement-breakpoint
CREATE TABLE requests (id TEXT PRIMARY KEY NOT NULL, ts INTEGER NOT NULL, ip TEXT NOT NULL, ua TEXT NOT NULL, client_family TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, resource_slug TEXT, decision TEXT NOT NULL CHECK(decision IN ('allow_token','allow_grant','allow_internal','allow_public','deny_pending','deny_blocked','deny_unknown','not_found')), token_id TEXT, grant_id TEXT, status INTEGER NOT NULL, bytes INTEGER NOT NULL, latency_ms INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('app','nginx')));
--> statement-breakpoint
CREATE INDEX requests_ts_idx ON requests(ts);
--> statement-breakpoint
CREATE TRIGGER requests_no_update BEFORE UPDATE ON requests BEGIN SELECT RAISE(ABORT, 'requests is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER requests_no_delete BEFORE DELETE ON requests BEGIN SELECT RAISE(ABORT, 'requests is append-only'); END;
--> statement-breakpoint
CREATE TABLE approvals (id TEXT PRIMARY KEY NOT NULL, request_id TEXT NOT NULL REFERENCES requests(id), subject TEXT NOT NULL, tg_message_id INTEGER, action TEXT NOT NULL CHECK(action IN ('allow','deny','device_token')), actor TEXT NOT NULL, duration_s INTEGER NOT NULL, ts INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE blocks (subject TEXT PRIMARY KEY NOT NULL, until INTEGER NOT NULL, reason TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE pending (id TEXT PRIMARY KEY NOT NULL, subject TEXT NOT NULL, request_id TEXT NOT NULL, slugs TEXT NOT NULL CHECK(json_valid(slugs)), expires_at INTEGER NOT NULL, resolved_at INTEGER, messages TEXT NOT NULL CHECK(json_valid(messages)));
--> statement-breakpoint
CREATE INDEX pending_subject_idx ON pending(subject);
--> statement-breakpoint
CREATE TABLE bot_events (id TEXT PRIMARY KEY NOT NULL, ts INTEGER NOT NULL, actor TEXT NOT NULL, event TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE login_codes (id TEXT PRIMARY KEY NOT NULL, secret_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER);
