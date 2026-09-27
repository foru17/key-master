import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createApp } from "../apps/server/dist/app.js";
import { TelegramBot } from "../apps/server/dist/bot/telegram.js";
import { configSchema } from "../apps/server/dist/config.js";
import { openStore } from "../apps/server/dist/db.js";
import * as schema from "../apps/server/dist/schema.js";

const require = createRequire(new URL("../apps/server/package.json", import.meta.url));
const { serve } = require("@hono/node-server");
const store = openStore(process.env.KM_SEED_DB ?? "data/seed.db");
const config = configSchema.parse({
  admin: { allowed_cidrs: ["127.0.0.0/8", "::1/128"] },
  telegram: { owner_chat_ids: ["10001"] },
  notice: {
    contact_text: "Contact the example administrator",
    contact_url: "https://example.com/contact",
    footer: "Private resources. Intentional access.",
  },
});
const secrets = {
  sessionSecret: "LOCAL_PREVIEW_ONLY_SESSION_SECRET_32",
  telegramToken: "",
  tokenPepper: "",
};

// Preview-only IP origin data. Documentation ranges (RFC 5737 / RFC 3849) are "reserved" to the real
// resolver, so the preview answers from this fixed table to show what a configured lookup looks like.
const mockNetworks = [
  {
    country: "HK",
    countryName: "Hong Kong",
    city: null,
    continent: "AS",
    asn: "AS64500",
    asName: "Example Mobile HK",
    asDomain: "mobile.example",
  },
  {
    country: "CN",
    countryName: "China",
    city: "Shenzhen",
    continent: "AS",
    asn: "AS64501",
    asName: "Example Broadband Guangdong",
    asDomain: "broadband.example",
  },
  {
    country: "SG",
    countryName: "Singapore",
    city: "Singapore",
    continent: "AS",
    asn: "AS64502",
    asName: "Example Cloud Asia",
    asDomain: "cloud.example",
  },
  {
    country: "US",
    countryName: "United States",
    city: "San Jose",
    continent: "NA",
    asn: "AS64503",
    asName: "Example Transit",
    asDomain: "transit.example",
  },
];
const mockJapan = {
  country: "JP",
  countryName: "Japan",
  city: "Tokyo",
  continent: "AS",
  asn: "AS64504",
  asName: "Example Fiber",
  asDomain: "fiber.example",
};
const blank = {
  country: null,
  countryName: null,
  city: null,
  continent: null,
  asn: null,
  asName: null,
  asDomain: null,
};
function mockScope(ip) {
  if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) return "private";
  if (/^127\.|^::1$/.test(ip)) return "loopback";
  if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(ip)) return "cgnat";
  if (/^fe80:/i.test(ip)) return "link_local";
  return "public";
}
function mockInfo(raw) {
  const ip = String(raw ?? "").split("|")[0];
  const scope = mockScope(ip);
  if (scope !== "public") return { ip, scope, ...blank, source: "none" };
  if (ip.startsWith("203.0.113.")) {
    const last = Number(ip.split(".")[3] ?? 0);
    return { ip, scope, ...mockNetworks[last % mockNetworks.length], source: "mmdb" };
  }
  if (ip.startsWith("198.51.100.") || /^2001:db8:/i.test(ip))
    return { ip, scope, ...mockJapan, source: "mmdb" };
  return { ip, scope, ...blank, source: "none" };
}
const geo = {
  enabled: true,
  cached: (ip) => mockInfo(ip),
  lookup: async (ip) => mockInfo(ip),
};

// Preview-only richer data: realistic clients and a longer resource list (idempotent inserts).
if (process.env.KM_PREVIEW_RICH !== "0") {
  const now = Date.now();
  const extra = [
    ["/example-clash", "approval", "file", "example-clash.yaml"],
    ["/example-clash-abroad", "approval", "file", "example-clash-abroad.yaml"],
    ["/example-surge", "approval", "file", "example-surge.conf"],
    ["/example-quanx", "approval", "inline", "Example Quantumult X profile\n"],
    ["/example-loon", "approval", "inline", "Example Loon profile\n"],
    ["/example-server", "token_only", "file", "example-server.yaml"],
    ["/example-gateway", "token_only", "upstream", "https://upstream.example.com/gateway"],
    ["/example-friends", "public", "inline", "Example shared profile for friends\n"],
    ["/example-rules.ini", "public", "upstream", "https://rules.example.com/base.ini"],
    ["/example-legacy", "approval", "inline", "Example legacy profile\n"],
  ];
  const clients = [
    [
      "203.0.113.60",
      "Shadowrocket/3445 CFNetwork/3896.100.1.2.1 Darwin/27.0.0 iPhone18,3",
      "shadowrocket",
      "/example-clash",
      "allow_grant",
      200,
    ],
    [
      "2001:db8:4a1:20::18",
      "clash.meta/v1.19.23",
      "mihomo",
      "/example-clash-abroad",
      "allow_token",
      200,
    ],
    ["203.0.113.61", "Surge Mac/7400", "surge", "/example-surge", "allow_grant", 200],
    [
      "10.0.0.8",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
      "browser",
      "/example-friends",
      "allow_internal",
      200,
    ],
    ["100.101.102.103", "curl/8.7.1", "curl", "/example-server", "allow_token", 200],
    ["198.51.100.23", "python-requests/2.32.3", "python", "/example-gateway", "deny_unknown", 403],
    [
      "203.0.113.62",
      "Mozilla/5.0 (compatible; ExamplePreview/1.0; link preview; +https://example.com/preview)",
      "unknown",
      "/example-clash",
      "deny_pending",
      403,
    ],
    [
      "203.0.113.63",
      "Mozilla/5.0 (compatible; ExampleScanner/2.0; +https://example.com/scanner)",
      "unknown",
      "/example-legacy",
      "deny_unknown",
      403,
    ],
    ["203.0.113.64", "clash-verge/v2.4.0", "clash-verge", "/example-clash", "allow_grant", 200],
  ];
  store.db.transaction((tx) => {
    for (const [i, [slug, policy, kind, source]] of extra.entries())
      tx.insert(schema.resources)
        .values({
          id: `EXAMPLE_PREVIEW_RESOURCE_${i}`,
          slug,
          kind,
          source,
          contentType: "text/plain; charset=utf-8",
          policy,
          enabled: slug !== "/example-legacy",
          createdAt: now - 14 * 86400000,
          updatedAt: now - 86400000,
        })
        .onConflictDoNothing()
        .run();
    for (const [i, [ip, ua, family, slug, decision, status]] of clients.entries())
      for (let n = 0; n < 1 + (i % 3); n++)
        tx.insert(schema.requests)
          .values({
            id: `EXAMPLE_PREVIEW_REQUEST_${i}_${n}`,
            ts: now - (i * 47 + n * 13 + 3) * 60000,
            ip,
            ua,
            headers: { accept: "*/*" },
            clientFamily: family,
            method: "GET",
            path: slug,
            resourceSlug: slug,
            decision,
            tokenId: null,
            grantId: null,
            status,
            bytes: status === 200 ? 18432 + i * 512 : 162,
            latencyMs: 4 + i,
            source: "app",
          })
          .onConflictDoNothing()
          .run();
  });
}

mkdirSync(".verification", { recursive: true });
const bot = new TelegramBot(
  store,
  config,
  secrets,
  {
    async call(method, payload) {
      if (method === "getMe") return { username: "example_bot" };
      if (method === "sendMessage") {
        const match = String(payload.text).match(/: (\d{6})$/);
        if (match) writeFileSync(".verification/telegram-code.txt", match[1], { mode: 0o600 });
      }
      return { message_id: 1 };
    },
  },
  Date.now,
  geo,
);
await bot.refreshIdentity();
const app = createApp({ store, config, secrets, bot, geo });
const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: Number(process.env.KM_PREVIEW_PORT ?? 4173),
});
console.info(
  "Local preview ready (mock Telegram transport and IP origins; code in ignored .verification/telegram-code.txt)",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      store.sqlite.close();
      process.exit(0);
    }),
  );
