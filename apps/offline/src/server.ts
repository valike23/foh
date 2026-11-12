import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { LocalStore } from "./store.js";
import { createOfflineApp } from "./app.js";

const path = process.env.OFFLINE_DB_PATH ?? join(process.cwd(), "data", "offline.sqlite");
const store = new LocalStore(path);
writeFileSync(`${path}.setup-key.txt`, store.meta("setupKey")!, { mode: 0o600 });
const { app, worker } = createOfflineApp(store, { allowedHosts: process.env.OFFLINE_ALLOWED_HOSTS?.split(",").filter(Boolean) });
const server = app.listen(Number(process.env.OFFLINE_API_PORT ?? 5381), "127.0.0.1", () => {
  console.log(`Local hub ready. Open http://localhost:${process.env.OFFLINE_UI_PORT ?? 5380}/offline/setup\nSetup key file: ${path}.setup-key.txt`);
  worker.start(Number(process.env.OFFLINE_SYNC_INTERVAL_MS ?? 300000));
});
for (const signal of ["SIGTERM", "SIGINT"] as const) process.once(signal, () => { worker.stop(); server.close(() => { store.close(); process.exit(0); }); });
