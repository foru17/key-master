import { randomBytes } from "node:crypto";
import { hashToken } from "@key-master/core";
import { ulid } from "ulid";
import { openStore } from "./db.js";
import * as schema from "./schema.js";

const path = process.env.KM_SEED_DB ?? "data/seed.db";
const store = openStore(path);
if (store.db.select().from(schema.resources).get()) {
  console.error("Seed requires an empty database; existing data was preserved.");
  store.sqlite.close();
  process.exitCode = 1;
} else {
  const now = Date.now();
  const resources = ["/example-feed", "/example-rules", "/example-status", "/example-archive"];
  store.db.transaction((tx) => {
    for (const [i, slug] of resources.entries())
      tx.insert(schema.resources)
        .values({
          id: `EXAMPLE_RESOURCE_${i}`,
          slug,
          kind: "inline",
          source: `Example resource ${i + 1}\n`,
          contentType: "text/plain; charset=utf-8",
          policy: i === 2 ? "public" : i === 1 ? "token_only" : "approval",
          enabled: i !== 3,
          createdAt: now - 7 * 86400000,
          updatedAt: now,
        })
        .run();
    for (let i = 0; i < 5; i++)
      tx.insert(schema.tokens)
        .values({
          id: `EXAMPLE_TOKEN_${i}`,
          label:
            [
              "Example build agent",
              "Example laptop",
              "Example tablet",
              "Example integration",
              "Example retired device",
            ][i] ?? "Example token",
          secretHash: hashToken(randomBytes(32).toString("hex")),
          scope: [resources[i % 3] ?? "/example-feed"],
          kind: i % 2 ? "device" : "machine",
          lastUsedAt: now - i * 3600000,
          revokedAt: i === 4 ? now - 86400000 : null,
          createdAt: now - 7 * 86400000,
        })
        .run();
    for (let i = 0; i < 6; i++)
      tx.insert(schema.grants)
        .values({
          id: `EXAMPLE_GRANT_${i}`,
          subjectKind: i % 2 ? "ip_client" : "ip",
          subject: `203.0.113.${20 + i}${i % 2 ? "|mihomo" : ""}`,
          scope: [resources[i % 3] ?? "/example-feed"],
          grantedBy: "admin:owner",
          expiresAt: now + (i === 5 ? -600000 : (i + 1) * 7200000),
          createdAt: now - 3600000,
        })
        .run();
    const clients = ["mihomo", "clash-verge", "surge", "curl", "stash"];
    for (let i = 0; i < 960; i++) {
      const slug = resources[i % 3] ?? "/example-feed";
      const family = clients[i % 5] ?? "curl";
      const isDenied = i % 11 === 0;
      const decision = isDenied
        ? "deny_pending"
        : i % 3 === 0
          ? "allow_grant"
          : i % 3 === 1
            ? "allow_token"
            : "allow_public";
      tx.insert(schema.requests)
        .values({
          id: ulid(now - i * 88000),
          ts: now - Math.floor((i / 960) ** 1.6 * 86400000),
          ip: `203.0.113.${7 + (i % 29)}`,
          ua: `Example/${family} 1.0`,
          headers: { accept: "text/plain", "accept-language": "en" },
          clientFamily: family,
          method: "GET",
          path: slug,
          resourceSlug: slug,
          decision,
          tokenId: decision === "allow_token" ? `EXAMPLE_TOKEN_${i % 4}` : null,
          grantId: decision === "allow_grant" ? `EXAMPLE_GRANT_${i % 5}` : null,
          status: isDenied ? 403 : 200,
          bytes: isDenied ? 126 : 2400 + (i % 180),
          latencyMs: 4 + ((i * 13) % 87),
          source: i % 4 === 0 ? "nginx" : "app",
        })
        .run();
    }
    for (let day = 1; day <= 6; day++)
      for (let i = 0; i < 30; i++)
        tx.insert(schema.requests)
          .values({
            id: ulid(now - day * 86400000 - i * 360000),
            ts: now - day * 86400000 - i * 360000,
            ip: `203.0.113.${7 + (i % 20)}`,
            ua: "Example/mihomo 1.0",
            clientFamily: "mihomo",
            method: "GET",
            path: "/example-feed",
            resourceSlug: "/example-feed",
            decision: i % 6 ? "allow_token" : "deny_blocked",
            tokenId: i % 6 ? "EXAMPLE_TOKEN_0" : null,
            status: i % 6 ? 200 : 403,
            bytes: 2300,
            latencyMs: 12,
            source: "app",
          })
          .run();
    for (let i = 0; i < 3; i++) {
      const requestId = `EXAMPLE_PENDING_REQUEST_${i}`;
      const subject = `203.0.113.${42 + i}|${clients[i]}`;
      tx.insert(schema.requests)
        .values({
          id: requestId,
          ts: now - i * 60000,
          ip: `203.0.113.${42 + i}`,
          ua: `Example/${clients[i]} 1.0 (Example device)`,
          headers: { accept: "text/plain", "accept-language": "en-US" },
          clientFamily: clients[i] ?? "mihomo",
          method: "GET",
          path: "/example-feed",
          resourceSlug: "/example-feed",
          decision: "deny_pending",
          status: 403,
          bytes: 120,
          latencyMs: 8,
          source: "app",
        })
        .run();
      tx.insert(schema.pending)
        .values({
          id: `EXAMPLE_PENDING_${i}`,
          requestId,
          subject,
          slugs: ["/example-feed"],
          expiresAt: now + 86400000,
          messages: [],
        })
        .run();
    }
    tx.insert(schema.approvals)
      .values({
        id: "EXAMPLE_APPROVAL",
        requestId: "EXAMPLE_PENDING_REQUEST_0",
        subject: "203.0.113.19|curl",
        action: "allow",
        actor: "admin:owner",
        durationS: 600,
        ts: now - 7200000,
      })
      .run();
  });
  console.info(
    `Seeded ${path}: 4 resources, 5 tokens, 6 grants, 1143 requests, 3 pending approvals. Example values only.`,
  );
  store.sqlite.close();
}
