CREATE TABLE requests_new (id TEXT PRIMARY KEY NOT NULL, ts INTEGER NOT NULL, ip TEXT NOT NULL, ua TEXT NOT NULL, client_family TEXT NOT NULL, method TEXT NOT NULL, path TEXT NOT NULL, resource_slug TEXT, decision TEXT NOT NULL CHECK(decision IN ('allow_token','allow_allowlist','allow_grant','allow_internal','allow_public','deny_pending','deny_blocked','deny_unknown','not_found','admin_api')), token_id TEXT, grant_id TEXT, allowlist_id TEXT, status INTEGER NOT NULL, bytes INTEGER NOT NULL, latency_ms INTEGER NOT NULL, source TEXT NOT NULL CHECK(source IN ('app','nginx')), headers TEXT NOT NULL DEFAULT '{}');
--> statement-breakpoint
INSERT INTO requests_new (id,ts,ip,ua,client_family,method,path,resource_slug,decision,token_id,grant_id,allowlist_id,status,bytes,latency_ms,source,headers) SELECT id,ts,ip,ua,client_family,method,path,resource_slug,CASE WHEN resource_slug IS NULL AND path LIKE '/api/%' AND decision='not_found' THEN 'admin_api' ELSE decision END,token_id,grant_id,allowlist_id,status,bytes,latency_ms,source,headers FROM requests;
--> statement-breakpoint
CREATE TABLE approvals_backup AS SELECT * FROM approvals;
--> statement-breakpoint
DROP TABLE approvals;
--> statement-breakpoint
DROP TABLE requests;
--> statement-breakpoint
ALTER TABLE requests_new RENAME TO requests;
--> statement-breakpoint
CREATE TABLE approvals (id TEXT PRIMARY KEY NOT NULL, request_id TEXT NOT NULL REFERENCES requests(id), subject TEXT NOT NULL, tg_message_id INTEGER, action TEXT NOT NULL CHECK(action IN ('allow','deny','device_token','always')), actor TEXT NOT NULL, duration_s INTEGER NOT NULL, ts INTEGER NOT NULL);
--> statement-breakpoint
INSERT INTO approvals SELECT * FROM approvals_backup;
--> statement-breakpoint
DROP TABLE approvals_backup;
--> statement-breakpoint
CREATE INDEX requests_ts_idx ON requests(ts);
--> statement-breakpoint
CREATE TRIGGER requests_no_update BEFORE UPDATE ON requests BEGIN SELECT RAISE(ABORT, 'requests is append-only'); END;
--> statement-breakpoint
CREATE TRIGGER requests_no_delete BEFORE DELETE ON requests BEGIN SELECT RAISE(ABORT, 'requests is append-only'); END;
--> statement-breakpoint
CREATE INDEX requests_filter_idx ON requests(resource_slug, ts);
--> statement-breakpoint
CREATE INDEX requests_token_idx ON requests(token_id, ts);
