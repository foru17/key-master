import { hashToken } from "@key-master/core";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { configSchema } from "./config.js";
import { openStore, type Store, syncTokens } from "./db.js";
import * as schema from "./schema.js";

const now = Date.parse("2026-09-27T07:22:09Z");
const imported = {
  id: "example-nginx-token",
  label: "Example nginx integration",
  secret_sha256: hashToken("EXAMPLE_EXTERNAL_TOKEN"),
  scope: ["/private"],
  kind: "machine",
};
let store: Store;
beforeEach(() => {
  store = openStore();
});
afterEach(() => store.sqlite.close());

describe("machine token configuration", () => {
  it.each([
    { id: "" },
    { id: "invalid/id" },
    { label: "" },
    { secret_sha256: "EXAMPLE_PLAINTEXT" },
    { secret_sha256: "g".repeat(64) },
    { scope: [] },
    { scope: ["private"] },
    { kind: "device" },
    { secret: "EXAMPLE_PLAINTEXT" },
    { token: "EXAMPLE_PLAINTEXT" },
    { expires_at: "not-a-date" },
    { expires_at: "2027-01-01T00:00:00" },
    { expires_at: -1 },
    { expires_at: 8640000000000001 },
    { expires_at: 1.5 },
  ])("rejects invalid or plaintext-bearing token %j", (patch) => {
    expect(configSchema.safeParse({ tokens: [{ ...imported, ...patch }] }).success).toBe(false);
  });
  it("rejects duplicate IDs and defaults to no imports", () => {
    expect(configSchema.safeParse({ tokens: [imported, imported] }).success).toBe(false);
    expect(configSchema.parse({}).tokens).toEqual([]);
  });
  it.each([
    [undefined, null],
    [0, 0],
    [now, now],
    ["2026-09-27T15:22:09+08:00", now],
    ["2026-09-27T07:22:09Z", now],
  ])("imports expiry %s", (expires_at, expected) => {
    const config = configSchema.parse({
      tokens: [{ ...imported, expires_at, secret_sha256: imported.secret_sha256.toUpperCase() }],
    });
    syncTokens(store, config, now);
    expect(store.db.select().from(schema.tokens).get()).toMatchObject({
      id: imported.id,
      secretHash: imported.secret_sha256,
      expiresAt: expected,
      createdAt: now,
    });
    expect(JSON.stringify(store.db.select().from(schema.tokens).all())).not.toContain(
      "EXAMPLE_EXTERNAL_TOKEN",
    );
    expect(JSON.stringify(config)).not.toContain("EXAMPLE_EXTERNAL_TOKEN");
  });
  it("upserts by id without erasing usage, revocation, creation or unrelated tokens", () => {
    const config = configSchema.parse({ tokens: [imported, { ...imported, id: "example-other" }] });
    syncTokens(store, config, now);
    store.db
      .update(schema.tokens)
      .set({ revokedAt: now + 1, lastUsedAt: now - 1 })
      .where(eq(schema.tokens.id, imported.id))
      .run();
    const changed = configSchema.parse({
      tokens: [
        {
          ...imported,
          label: "Updated example",
          scope: ["*"],
          secret_sha256: hashToken("EXAMPLE_ROTATED_TOKEN"),
          expires_at: now + 60000,
        },
      ],
    });
    syncTokens(store, changed, now + 2);
    syncTokens(store, changed, now + 3);
    expect(store.db.select().from(schema.tokens).all()).toHaveLength(2);
    expect(
      store.db.select().from(schema.tokens).where(eq(schema.tokens.id, imported.id)).get(),
    ).toMatchObject({
      label: "Updated example",
      scope: ["*"],
      secretHash: hashToken("EXAMPLE_ROTATED_TOKEN"),
      expiresAt: now + 60000,
      revokedAt: now + 1,
      lastUsedAt: now - 1,
      createdAt: now,
    });
    syncTokens(store, config, now + 4);
    expect(
      store.db.select().from(schema.tokens).where(eq(schema.tokens.id, imported.id)).get()
        ?.expiresAt,
    ).toBeNull();
    syncTokens(store, configSchema.parse({}), now + 5);
    expect(store.db.select().from(schema.tokens).all()).toHaveLength(2);
  });
});
