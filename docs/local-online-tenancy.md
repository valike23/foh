# Main app: tenant workspaces with local PostgreSQL

The main Next.js dashboard now handles online onboarding and service navigation. There is no separate onboarding test page. The PostgreSQL API runs privately on port 4200; its root URL redirects to the main app on port 5173.

## Start locally

Create a PostgreSQL database and put its connection string in apps/cloud/.env (copy apps/cloud/.env.example if needed). Credentials stay out of Git. Percent-encode reserved characters in passwords.

Run from the repository root:

```powershell
npm install
npm run db:migrate
npm run dev:online
```

Open **http://app.localhost:5173**. Create an organization, choose a subdomain, then follow the workspace link and sign in. Existing tenants from the earlier port-4200 implementation can sign in at the same subdomain on port 5173 with their existing credentials.

The command starts both the PostgreSQL API and the main dashboard. If the dashboard is already running on 5173, start only the API with npm run dev:online -w @exa-foh/cloud. A port-in-use error should not be resolved by stopping an unrelated process.

## Main navigation

After login, the original dark management workspace opens at **Dashboard**, with a Dashboard item added to the original sidebar. Venues, Events, Vendors, Storefronts, Floor & QR, Account & access, and Service operations remain in place. Tenant signup and login have a modern dedicated layout, while the dashboard retains its original sidebar and dark design.

- Dashboard shows business-wide venue/event/live-service counts, a selected service?s sales, collected payments, outstanding balances, quarter-hour activity, alerts and recent sales. New workspaces show setup actions and real zero totals. It inherits tenant branding and refreshes selected-service records through the authenticated APIs.
- Overview shows service totals, recorded payment methods, recent sales, low-stock alerts, tables and staff sales from the selected operation. Empty workspaces have setup guidance, not seeded sample revenue.
- Sales creates staff orders and displays receipts. Orders handles acceptance and preparation/service status. Payments records cash, card/POS or bank-transfer payments and displays payment history. These are separate screens, with navigation and available actions based on staff assignments.
- Stock creates menu items and records quantity adjustments with a reason.
- Floor control shows tables, current-service balances and their sales.
- Existing management pages remain in the original sidebar. The supplementary operational pages are reached through service workflows rather than a replacement top navigation.

Create a venue or event, create and activate its vendor and storefront, and configure any sections/tables. Publish the operation under Service operations. Add menu items in Stock, then open service under Service operations. Open a published operation from Service operations. On-screen totals are scoped to the current or most recent operating period.

To change a published floor layout, pause service first (or edit during setup/after closing). A blocked floor form includes **Manage this operation**, opening the relevant Service operations entry in a new tab while preserving the form. Pause, return and save the floor changes, then resume service. Floor changes update the published sections/tables/seats atomically and preserve orders, menu, stock, payments, table states and waiter assignments. Referenced tables/seats cannot be removed or moved across storefronts/tables, and active child locations cannot be orphaned. Published storefront configuration remains locked.

## Optional organization branding

Signup includes a Make it yours section. Choose a preset or a six-digit hex brand colour, and optionally upload a PNG, JPEG or WebP logo up to 512 KB and 16 megapixels. Uploads must be static images; the API validates the decoded content and normalizes it to a WebP no larger than 256 by 256 pixels, preserving aspect ratio and transparency.

Branding is saved on the PostgreSQL tenant record. The public tenant lookup supplies it before login, so each tenant subdomain displays its organization name, logo and accent. After sign-in, the original dashboard sidebar displays the organization identity; primary buttons, focus rings and the active-link accent use the chosen colour. Branding does not change tenant permissions or menu structure.

Both fields are optional. Existing organizations and new signups without branding keep the EXA logo and default colour. Logos are public branding assets and are stored as normalized data URLs rather than accepting arbitrary external URLs. The selected colour determines a readable contrasting button-text colour. Editing branding after signup is not part of this change.

## Storage and isolation

Tenant accounts, password hashes, sessions, venues, storefronts and staff assignments live in dedicated PostgreSQL tables through Prisma. Existing venue forms keep their full profile, opening hours and status. Events, vendors, floor configuration and published service snapshots use tenant-scoped WorkspaceRecord rows with JSONB data. Their domain shape remains compatible with the on-site snapshot; this is not yet a fully normalized transactional schema. Owners configure scoped staff roles under Account & access; see [Storefronts and roles](storefronts-and-roles.md) for the permission matrix and migration details.

All online requests go through the main app's same-origin API proxy, which preserves the original Host and forwards only the required cookies and headers. The backend resolves tenant identity from the exact configured subdomain. Every record lookup and mutation is tenant scoped. Cookies are HTTP-only, host-only and SameSite Strict, with Secure enabled under HTTPS. Mutations require the matching Origin. Runtime writes use database transactions and revision checks; competing requests cannot overwrite stock or duplicate a completed payment.

Use PostgreSQL for online development and online deployment. The on-site app at **http://localhost:5173** continues using the local SQLite hub. The host-based deployment switch can be overridden with EXA_DEPLOYMENT_MODE=online or onsite. See apps/boh-dashboard/.env.example. Different database providers need separate migrations; the ORM does not convert database files or implement offline synchronization.

## What remains on-site

Guest QR ordering, guest appearance/media uploads, runner routing, advanced reports, payout/register workflows and hub/cloud sync remain on the existing on-site implementation. Guest appearance and QR issuance are not offered in the online workspace yet. Existing SQLite data is preserved and is not silently imported into a tenant. Pairing a hub, authenticating uploads, transferring media and defining conflict/deletion rules are subsequent sync work.

## Checks

```powershell
npm run typecheck
npm run test:online
npx playwright install chromium
npm run test:workspace:browser
```

The PostgreSQL integration test uses the configured database, creates uniquely named temporary tenants and deletes only those tenants afterward. It checks tenancy isolation, configuration, publishing, opening service, stock deduction, duplicate-payment rejection and competing sales. With no DATABASE_URL it skips the PostgreSQL test; an invalid connection fails it.

The browser flow uses the main app at 5173 and the API at 4200. It exercises signup, tenant redirection, login, the original venue form, stock entry, sales, payment, the original sidebar, logout and mobile overflow. It removes its temporary tenant and saves screenshots under test-results/main-workspace (ignored by Git).

For Prisma schema changes, stop the API before npm run db:generate -w @exa-foh/cloud: Windows locks its loaded engine DLL. Client generation also runs after dependency installation. Deployment applies committed migration files with npm run db:migrate; do not use database resets on records you need.

Modern browsers resolve *.localhost to loopback. If necessary, add your chosen app/tenant hostnames to your Windows hosts file with administrator privileges. Online deployment requires wildcard DNS/TLS, a reverse proxy preserving Host, and matching TENANT_BASE_DOMAIN, ONLINE_PUBLIC_ORIGIN and DASHBOARD_PUBLIC_ORIGIN configuration. Public onboarding also still needs email verification, recovery and distributed rate limiting.

References: [Prisma providers](https://www.prisma.io/docs/orm/v6/reference/prisma-schema-reference), [provider-specific migrations](https://docs.prisma.io/docs/orm/v7/prisma-migrate/understanding-prisma-migrate/limitations-and-known-issues).
