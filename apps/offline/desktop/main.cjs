const { app, BrowserWindow, Tray, Menu, dialog, nativeImage, shell } = require("electron");
const { spawn } = require("node:child_process");
const { join } = require("node:path");
const { existsSync, readFileSync, mkdirSync, createWriteStream } = require("node:fs");
const { randomBytes } = require("node:crypto");
app.setName("Pricemate Local Hub");
if (process.env.OFFLINE_USER_DATA) app.setPath("userData", process.env.OFFLINE_USER_DATA);
if (!app.requestSingleInstanceLock()) app.quit();
let window, tray, children = [], quitting = false, startupError;
const instanceId = randomBytes(16).toString("hex");
const port = Number(process.env.OFFLINE_UI_PORT || 5380), apiPort = Number(process.env.OFFLINE_API_PORT || 5381), origin = `http://127.0.0.1:${port}`;
function start(script, env, cwd) {
  const childEnv = { ...process.env, ...env, ELECTRON_RUN_AS_NODE: "1" };
  delete childEnv.NODE_OPTIONS; delete childEnv.NODE_PATH;
  const logDirectory = join(app.getPath("userData"), "logs"); mkdirSync(logDirectory, { recursive: true });
  const log = createWriteStream(join(logDirectory, "services.log"), { flags: "a" });
  const child = spawn(process.execPath, [script], { cwd, env: childEnv, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  child.on("close", () => log.end());
  children.push(child);
  child.on("error", error => dialog.showErrorBox("Local hub failed to start", error.message));
  child.on("exit", code => { if (!quitting && code !== 0) startupError = new Error("A local service stopped. Check that ports 5380 and 5381 are available, then restart Pricemate Local Hub."); });
}
async function wait(url, expectedInstance) {
  for (let attempt = 0; attempt < 90; attempt++) {
    if (startupError) throw startupError;
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok && (!expectedInstance || (await response.json()).instanceId === expectedInstance)) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error("The local services did not start. Check that ports 5380 and 5381 are free.");
}
function open(path = "/offline/setup") { window.show(); window.focus(); window.loadURL(origin + path); }
app.on("second-instance", () => window?.show());
app.whenReady().then(async () => {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    const resources = app.isPackaged ? process.resourcesPath : __dirname;
    const frontend = join(resources, "frontend/apps/boh-dashboard");
    const server = app.isPackaged ? join(resources, "hub/server.cjs") : join(__dirname, "../dist/server.cjs");
    const database = join(app.getPath("userData"), "hub/offline.sqlite");
    start(server, { OFFLINE_DB_PATH: database, OFFLINE_API_PORT: String(apiPort), OFFLINE_UI_PORT: String(port), OFFLINE_INSTANCE_ID: instanceId }, app.getPath("userData"));
    await wait(`http://127.0.0.1:${apiPort}/health`, instanceId);
    start(join(frontend, "server.js"), { NODE_ENV: "production", PORT: String(port), HOSTNAME: "0.0.0.0", EXA_OFFLINE_MODE: "1", EXA_DEPLOYMENT_MODE: "online", ONLINE_INTERNAL_URL: `http://127.0.0.1:${apiPort}`, ONLINE_PROXY_SECRET: "", TENANT_ROUTING_MODE: "subdomain" }, frontend);
    await wait(origin + "/offline/setup");
    const iconPath = join(__dirname, "icon.png");
    window = new BrowserWindow({ show: process.env.OFFLINE_SMOKE_TEST !== "1", width: 1120, height: 800, minWidth: 700, minHeight: 550, title: "Pricemate Local Hub", icon: iconPath, autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.on("will-navigate", (event, url) => { if (new URL(url).origin !== origin) event.preventDefault(); });
    window.webContents.setWindowOpenHandler(({ url }) => {
      if (new URL(url).origin === origin) return { action: "allow", overrideBrowserWindowOptions: { autoHideMenuBar: true, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true } } };
      if (url.startsWith("https://")) void shell.openExternal(url);
      return { action: "deny" };
    });
    window.on("close", event => { if (!quitting) { event.preventDefault(); window.hide(); } });
    tray = new Tray(nativeImage.createFromPath(iconPath)); tray.setToolTip("Pricemate Local Hub · serving this venue");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Open local hub", click: () => open() },
      { label: "Open POS", click: () => open("/pos") },
      { label: "Staff / kitchen login", click: () => open("/login") },
      { label: "Sync status", click: () => open("/sync") },
      { type: "separator" },
      { label: "Start with Windows", type: "checkbox", checked: app.getLoginItemSettings().openAtLogin, click: item => app.setLoginItemSettings({ openAtLogin: item.checked }) },
      { label: "Quit hub", click: async () => { const result = await dialog.showMessageBox({ type: "question", buttons: ["Keep running", "Quit hub"], defaultId: 0, cancelId: 0, message: "Quit the local hub?", detail: "Other devices will lose access until this hub starts again. Local records remain saved." }); if (result.response === 1) { quitting = true; app.quit(); } } },
    ]));
    tray.on("double-click", () => open());
    const keyFile = database + ".setup-key.txt";
    const key = existsSync(keyFile) ? readFileSync(keyFile, "utf8").trim() : "";
    await window.loadURL(origin + "/offline/setup" + (key ? `?setupKey=${encodeURIComponent(key)}` : ""));
  } catch (error) { dialog.showErrorBox("Unable to start Pricemate Local Hub", error.message); quitting = true; app.quit(); }
});
app.on("window-all-closed", () => {});
app.on("before-quit", () => { quitting = true; for (const child of children) child.kill(); });
