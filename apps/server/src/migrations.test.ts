import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { expect, it } from "vitest";

it.each([
  ["/api/auth/request-code", null, "not_found", "app", "admin_api"],
  ["/api/auth/verify", null, "not_found", "app", "admin_api"],
  ["/api/admin/grants", null, "not_found", "app", "admin_api"],
  ["/api/", null, "not_found", "app", "admin_api"],
  ["/nope", null, "not_found", "app", "not_found"],
  ["/api", null, "not_found", "app", "not_found"],
  ["/api-example", null, "not_found", "app", "not_found"],
  ["/api/example", "/api/example", "not_found", "app", "not_found"],
  ["/api/example", "", "not_found", "app", "not_found"],
  ["/api/example", null, "deny_unknown", "app", "deny_unknown"],
  ["/api/example", "/api/example", "not_found", "nginx", "not_found"],
  ["/private", "/private", "allow_allowlist", "app", "allow_allowlist"],
])(
  "migrates %s (%s, %s, %s) to %s and preserves audit integrity",
  (path, resourceSlug, decision, source, expected) => {
    const db = new Database(":memory:");
    try {
      db.pragma("foreign_keys = ON");
      for (const file of ["0000_initial", "0001_admin", "0002_ip_geo", "0003_allowlist"])
        db.exec(readFileSync(new URL(`../drizzle/${file}.sql`, import.meta.url), "utf8"));
      db.prepare(
        `INSERT INTO requests (id,ts,ip,ua,client_family,method,path,resource_slug,decision,
          token_id,grant_id,allowlist_id,status,bytes,latency_ms,source,headers)
         VALUES ('old',1,'203.0.113.1','curl/8','curl','POST',?,?,?,
          'example-token','example-grant','example-allowlist',200,123,4,?,'{"accept":"*/*"}')`,
      ).run(path, resourceSlug, decision, source);
      db.exec(
        "INSERT INTO approvals VALUES ('approval','old','203.0.113.1',1,'always','command',600,1)",
      );
      const row = db.prepare("SELECT * FROM requests").get() as Record<string, unknown>;
      const approvals = db.prepare("SELECT * FROM approvals").all();
      const columns = db.pragma("table_info(requests)");
      const indexesAndTriggers = () =>
        db
          .prepare(
            "SELECT type, name, sql FROM sqlite_master WHERE tbl_name='requests' AND type IN ('index','trigger') ORDER BY name",
          )
          .all();
      const definitions = indexesAndTriggers();
      db.transaction(() =>
        db.exec(readFileSync(new URL("../drizzle/0004_admin_api.sql", import.meta.url), "utf8")),
      )();
      expect(db.prepare("SELECT * FROM requests").all()).toEqual([{ ...row, decision: expected }]);
      expect(db.prepare("SELECT * FROM approvals").all()).toEqual(approvals);
      expect(db.pragma("table_info(requests)")).toEqual(columns);
      expect(indexesAndTriggers()).toEqual(definitions);
      expect(db.pragma("foreign_key_check")).toEqual([]);
      expect(() => db.exec("UPDATE requests SET status=404 WHERE id='old'")).toThrow("append-only");
      expect(() => db.exec("DELETE FROM requests WHERE id='old'")).toThrow("append-only");
      const insert = db.prepare(
        "INSERT INTO requests (id,ts,ip,ua,client_family,method,path,decision,status,bytes,latency_ms,source) VALUES (?,1,'203.0.113.1','','curl','POST','/api/example',?,200,0,0,'app')",
      );
      expect(() => insert.run("new", "admin_api")).not.toThrow();
      expect(() => insert.run("invalid", "invalid_decision")).toThrow("CHECK constraint failed");
      expect(() =>
        db.exec(
          "INSERT INTO approvals VALUES ('invalid','missing','203.0.113.1',NULL,'allow','command',600,1)",
        ),
      ).toThrow("FOREIGN KEY constraint failed");
    } finally {
      db.close();
    }
  },
);
