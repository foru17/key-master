import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

mkdirSync(".verification", { recursive: true });
process.env.KM_SEED_DB = ".verification/ui.db";
process.env.KM_PREVIEW_PORT = "4174";
for (const suffix of ["", "-wal", "-shm"])
  rmSync(`${process.env.KM_SEED_DB}${suffix}`, { force: true });
const result = spawnSync(process.execPath, ["apps/server/dist/seed.js"], {
  env: process.env,
  stdio: "inherit",
});
if (result.status !== 0) process.exit(result.status ?? 1);
await import("./preview.mjs");
