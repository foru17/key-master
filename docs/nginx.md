# nginx fronting example

This example requires nginx with the standard map, proxy and HTTP modules. It uses reserved example addresses. Replace placeholders locally and configure TLS on the public listener before deployment.

Machine tokens explicitly mapped in nginx can serve an immutable local resource even while key-master is down. Unknown tokens and requests without a token go through key-master's normal decision path. Keep nginx token maps root-readable and outside source control; nginx mappings are independent of SQLite, so revoke them in both places and reload nginx when necessary. Do not add device tokens to the direct map unless you intend this separate lifecycle.

Put the following in the `http` context. The map includes the URI to scope the token to one exact resource. A location alias supplies the fixed file; the request never controls a filesystem path.

```nginx
map "$uri:$arg_k" $km_token_id {
    default "";
    "/resource:YOUR_MACHINE_TOKEN" "example-nginx-token";
}
map $km_token_id $km_direct {
    "" 0;
    default 1;
}
map $km_direct $km_source {
    default proxy;
    1 direct;
}
map $upstream_http_x_request_id $km_request_id {
    "" $request_id;
    default $upstream_http_x_request_id;
}
log_format key_master_json escape=json
    '{"time_iso8601":"$time_iso8601",'
    '"remote_addr":"$remote_addr",'
    '"request_method":"$request_method",'
    '"uri":"$uri",'
    '"status":$status,'
    '"body_bytes_sent":$body_bytes_sent,'
    '"request_time":$request_time,'
    '"http_user_agent":"$http_user_agent",'
    '"km_token_id":"$km_token_id",'
    '"km_source":"$km_source"}';

upstream key_master_app {
    server 203.0.113.10:3000;
}

server {
    listen 80;
    server_name example.com;
    access_log /var/log/nginx/key-master.jsonl key_master_json;
    error_page 404 =404 /_static_404;

    location = /_static_404 {
        internal;
        default_type text/plain;
        add_header X-Request-Id $request_id always;
        return 404 "404 Not Found\n";
    }

    location = /resource {
        error_page 418 = @gatekeeper;
        if ($km_direct = 0) { return 418; }
        alias /srv/resources/resource.txt;
        default_type text/plain;
        add_header Cache-Control "private, no-store" always;
        add_header X-Request-Id $request_id always;
        limit_except GET { deny all; }
    }

    location @gatekeeper {
        proxy_pass http://key_master_app;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_hide_header X-Request-Id;
        add_header X-Request-Id $km_request_id always;
        proxy_intercept_errors off;
    }

    location / {
        proxy_pass http://key_master_app;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_hide_header X-Request-Id;
        add_header X-Request-Id $km_request_id always;
        proxy_intercept_errors off;
    }
}
```

Use a matching app resource:

```yaml
trusted_proxies: [203.0.113.20/32]
ingest:
  nginx_log: data/nginx-access.jsonl
notice:
  not_found_body: "404 Not Found\n"
tokens:
  - id: example-nginx-token
    label: Example nginx integration
    secret_sha256: "YOUR_64_CHARACTER_SHA256_HEX"
    scope: [/resource]
    kind: machine
    # expires_at: "2027-01-01T00:00:00Z"
resources:
  - slug: /resource
    kind: file
    source: resource.txt
    policy: approval
```

Replace `YOUR_64_CHARACTER_SHA256_HEX` locally with the 64-character SHA-256 digest of the existing token. With `KM_TOKEN_PEPPER`, hash the UTF-8 concatenation `pepper + token` (no separator), matching the application verifier. Keep plaintext only in the protected nginx map / local secret environment, never in `config.yaml` or SQLite. Hashes do not reveal the original token in the admin API.

On startup, `tokens` are upserted by `id`: label, hash, scope, kind and expiry follow YAML; created/last-used/revoked timestamps are preserved. Removing a YAML entry does not delete it, and restarting does not un-revoke it. Optional expiry accepts an ISO timestamp with an explicit zone or Unix milliseconds; omitting it removes the configured expiry. Changes require a restart. nginx still authorizes independently: app expiry, scope changes and revocation do not alter nginx's map.

The map above emits a fixed, non-secret label in `$km_token_id`, identical to the imported token `id`. The log parser copies it into audit `token_id` so Requests details and Tokens usage can be associated. Older logs without the field (or with empty / `-` values) remain supported and use null. Unknown IDs are retained for later correlation; the log label never grants access. Do not derive the label from a request header or log the secret itself.

Mount the same file content under the app's `file_root`. Mount the JSON log read-only at the configured ingest path; ensure the unprivileged app user can read it. Do not log `$request`, `$request_uri`, `$args` or `$arg_k`: those expose plaintext tokens. The ingest parser also removes query strings defensively.

Direct nginx requests retain nginx's own request ID; imported audit rows receive ULIDs. App responses use the application's ULID, including errors. Only `km_source: direct` lines are imported, avoiding duplicate app/proxy audit rows. Use rename-and-create log rotation; avoid multiple rotations between tail ticks. As with conventional file tailers, unread bytes in a rotated-away inode can be lost. The live file must remain available for the tailer.

Validate a deployment-specific configuration with `nginx -t`. This repository does not contact or alter an existing nginx server.
