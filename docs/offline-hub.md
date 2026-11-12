# Pricemate Local Hub

The Windows application runs the local server and a bundled browser frontend.
Cashier computers, waiter tablets and kitchen devices open the same hub in a
browser. They share one SQLite database; internet is needed for activation and
cloud sync, not for day-to-day local transactions. The hub and LAN must stay on.

## First use

1. Deploy the current cloud API and dashboard first. They include the new
   `/api/offline/*` device-enrolment and sync endpoints. No schema migration is
   needed for these endpoints; device records use tenant-scoped WorkspaceRecord.
2. Publish the desired venue or event online and configure its menus, stock and
   staff assignments. One installation controls one published operation.
3. Install **Pricemate Local Hub Setup 0.1.0.exe** from `apps/offline/release`.
4. Launch the desktop shortcut. The setup page receives the server's setup key
   automatically. Sign in with the online business owner's account and enter
   the business workspace URL, e.g. `https://business.pricemate.com.ng`.
5. Select the service and activate. This downloads its data and staff credential
   verifiers and transfers transaction authority to this hub.
6. Open POS on the server or open the displayed LAN address on another device:
   `http://SERVER_IP:5380/pos`. Staff and kitchen login: `http://SERVER_IP:5380/login`.
   Waiters use Sales/Orders and kitchen staff use Orders according to their roles.
7. Allow the application on the **private** local network in Windows Firewall.
   Give the server a stable IP/DHCP reservation so browser bookmarks stay valid.

Closing the desktop window hides it in the system tray; it does not stop service.
The tray menu can reopen the hub, POS, staff login and sync status, and optionally
start the application with Windows. Quitting the hub stops all connected devices.

The installer is an unsigned test build. Code signing and production deployment
of local HTTPS should be arranged before distributing it broadly. The bundled
frontend uses HTTP on the private LAN by default; do not expose port 5380 to the
internet. The API binds only to loopback on port 5381. Cloud traffic uses HTTPS
(loopback HTTP is permitted for development).

## Data and offline login

On Windows, data is stored under:

`%APPDATA%\Pricemate Local Hub\hub\offline.sqlite`

SQLite WAL transactions persist the runtime state and sync outbox together. The
cache contains this operation's venue/event, storefronts, sections/tables, menu,
inventory, orders, payments, staff and assignments. Passwords are never stored in
plaintext. Salted scrypt verifiers support offline login; browser responses never
include verifiers or device credentials. The desktop data directory and backups
must be protected as business data. POS and management use separate HttpOnly
sessions. Cached staff access lasts seven days after a successful cloud refresh.
Deactivated staff and changed passwords invalidate their local sessions after sync.
An online revocation cannot reach a disconnected hub until the next connection.

If the cache expires, restore internet and use **Reconnect and refresh staff
access** on the installed server's setup page, or let the periodic worker refresh
it. The installed server's setup key authorises this recovery without exposing
cached credentials to the browser. Staff provisioning and business configuration
are managed online; runtime stock, sales, payments and service lifecycle use the
shared online business rules locally. The public guest self-order API and online
payment provider processing are not implemented in this first local hub release.
Cash works locally; card/transfer receipts record externally verified payments.

## Sync and ownership

The worker runs every five minutes while the application is running, also on
startup, and through **Sync status → Sync now / retry**. It first refreshes staff
and configuration, then uploads locally committed changes. The UI shows stage,
actual change counts, pending and failed counts, last success, errors and retry.
POS has a small sync indicator. App sleep/OS shutdown pauses the worker; it resumes
on the next launch. It does not depend on browser background-sync support.

The active hub is the only transaction writer for its operation. The cloud still
serves reports, but refuses competing sales, guest orders, lifecycle and stock
changes. Other branches remain available online. PostgreSQL advisory locks and
revision checks make claiming a hub and cloud transactions mutually exclusive.

The initial protocol sends the owned operation's aggregate state, including stock
movements, orders and payments, rather than merging two independent stock totals.
Unsent revisions are coalesced into batches to avoid storing a full history copy
for every click. Each in-flight batch is frozen, assigned a durable sequence and
acknowledged against the cloud revision. Replaying a lost acknowledgement cannot
duplicate data. Conflicts stop sync and keep the local data; they never silently
overwrite an unexpected cloud revision. A batch limit of 32 MB applies.

For the owner, **Hand service back** stops further local writes, syncs remaining
changes and explicitly releases the cloud lease. If the connection fails during
handover, local writes stay paused until handover can finish. The local copy is
retained for reference. A released installation must not be used for new sales.
Reactivating a released hub through the UI is not yet supported; provision a fresh
installation/database after retaining the old copy. Do not delete a hub database
or force a lease takeover while unsynced changes exist.

Daily consistent SQLite backups are saved in `hub/backups`; the owner can also
request **Save a local backup** from Sync status. Backups include staff verifiers,
device credentials and the outbox. Keep them private and copy them to protected
external storage. A restored backup may require manual cloud revision
reconciliation; never run a restored copy concurrently with the original hub.

## Development and packaging

From the repository root:

```sh
npm ci --include=dev
npm run dev:offline
```

Open `http://localhost:5380/offline/setup`. For development, read the setup key from
`apps/offline/data/offline.sqlite.setup-key.txt`. A local online workspace such as
`http://business.localhost:5173` can be used for activation while the online API is
running. The local server resolves `.localhost` through loopback while preserving
the tenant Host. Data is separate from the older `apps/hub` prototype database.

Build the installer:

```sh
npm run package:offline:win
```

Packaging includes Electron, the SQLite service and the Next standalone frontend
with local fonts/icons, so target machines do not need Node.js, npm or PostgreSQL.
No data is stored inside the installation directory, and uninstalling does not
delete the hub's application data. Never include a test database in a release.

Tests: `apps/offline/tests/offline.test.mjs` covers roles, offline login, restart,
coalesced sync, lost acknowledgement, revocation and handover. The isolated LAN
browser fixture `scripts/offline-browser-flow.mjs` uses a test hub on ports 5380/5381,
real cloud activation, separate browser contexts and a private IPv4 address.

The initial packaged startup test failed because the packager omitted Next's
traced runtime dependencies. The packaging hook now explicitly includes and
checks those dependencies. The corrected installer has passed static package
checks but has not been launched again: the follow-up executable diagnostic was
declined. Treat it as a test build until startup is confirmed on a Windows machine.
If startup fails, inspect `%APPDATA%\Pricemate Local Hub\logs\services.log`.
