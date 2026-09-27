import { mkdirSync } from "node:fs";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { HttpTelegramApi, TelegramBot } from "./bot/telegram.js";
import { loadConfig } from "./config.js";
import { openStore, syncResources } from "./db.js";
import { tailNginx } from "./ingest.js";

const { config, secrets } = loadConfig(process.env.KM_CONFIG ?? "config.yaml");
mkdirSync(config.file_root, { recursive: true });
const store = openStore(config.db_path);
syncResources(store, config);
const enabled =
  secrets.telegramToken !== "" &&
  secrets.telegramToken !== "YOUR_BOT_TOKEN" &&
  config.telegram.owner_chat_ids.length > 0;
const bot = enabled
  ? new TelegramBot(store, config, secrets, new HttpTelegramApi(secrets.telegramToken))
  : undefined;
if (bot) void bot.refreshIdentity();
const app = createApp({ store, config, secrets, ...(bot ? { bot } : {}) });
const server = serve({ fetch: app.fetch, hostname: config.listen.host, port: config.listen.port });
const polling = bot && config.telegram.mode === "polling" ? bot.startPolling() : undefined;
const logPath = config.ingest.nginx_log;
const ingest = logPath
  ? setInterval(() => {
      try {
        tailNginx(store, logPath);
      } catch {
        console.error("Nginx ingestion failed / 日志导入失败");
      }
    }, 1000)
  : undefined;
console.info(
  `key-master listening on port ${config.listen.port}; Telegram ${enabled ? "enabled" : "disabled"}`,
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  polling?.stop();
  if (ingest) clearInterval(ingest);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await polling?.done;
  store.sqlite.close();
}
process.on("SIGINT", () => {
  void close();
});
process.on("SIGTERM", () => {
  void close();
});
