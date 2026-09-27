import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createApp } from "../apps/server/dist/app.js";
import { TelegramBot } from "../apps/server/dist/bot/telegram.js";
import { configSchema } from "../apps/server/dist/config.js";
import { openStore } from "../apps/server/dist/db.js";

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
mkdirSync(".verification", { recursive: true });
const bot = new TelegramBot(store, config, secrets, {
  async call(method, payload) {
    if (method === "getMe") return { username: "example_bot" };
    if (method === "sendMessage") {
      const match = String(payload.text).match(/: (\d{6})$/);
      if (match) writeFileSync(".verification/telegram-code.txt", match[1], { mode: 0o600 });
    }
    return { message_id: 1 };
  },
});
await bot.refreshIdentity();
const app = createApp({ store, config, secrets, bot });
const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: Number(process.env.KM_PREVIEW_PORT ?? 4173),
});
console.info(
  "Local preview ready (mock Telegram transport; code in ignored .verification/telegram-code.txt)",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () =>
    server.close(() => {
      store.sqlite.close();
      process.exit(0);
    }),
  );
