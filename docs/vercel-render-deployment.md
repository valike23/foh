# Vercel frontend + Render API

This configuration uses `https://foh-rouge.vercel.app` and `https://foh.onrender.com` without a custom domain. Deploy the version with **single-host routing and authenticated proxy forwarding** before applying these settings. The original subdomain mode remains the default for local development/custom domains.

## Shared proxy secret

Generate a random secret locally:

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Paste the same output into `ONLINE_PROXY_SECRET` in **both** Vercel and Render. This is a server-only setting; do not use a `NEXT_PUBLIC_` prefix. The frontend connects to Render using Render's actual hostname and signs its workspace-host forwarding with this secret. Ordinary `X-Forwarded-Host` headers remain untrusted.

## Render web service

Use the repository root (leave Root Directory blank), and deploy the branch containing the hosting changes.

Build command:

```sh
npm ci --include=dev && npm run build --workspace @exa-foh/shared && npm run build --workspace @exa-foh/cloud
```

The backend build explicitly builds `@exa-foh/shared` before TypeScript rather than relying on a prebuild hook. The Render command also names the shared build so its order is visible in deployment logs. Development dependencies are included because TypeScript and the Prisma CLI are needed during build/schema deployment. The repository pins the tested Node 22 release line; set `NODE_VERSION=22.22.2` explicitly on Render as shown below.

Start command:

```sh
npm run db:migrate --workspace @exa-foh/cloud && npm run start:online --workspace @exa-foh/cloud
```

Use **Health Check Path: `/health`**. Do not use `npm start` here: that starts the older SQLite prototype server.

Environment variables:

```dotenv
NODE_ENV=production
NODE_VERSION=22.22.2
DATABASE_URL=<your Render Postgres Internal Database URL>
TENANT_ROUTING_MODE=single-host
TENANT_BASE_DOMAIN=foh-rouge.vercel.app
ONLINE_PUBLIC_ORIGIN=https://foh-rouge.vercel.app
DASHBOARD_PUBLIC_ORIGIN=https://foh-rouge.vercel.app
ONLINE_HOST=0.0.0.0
ONLINE_PROXY_SECRET=<the generated secret>
```

Enter actual values without angle brackets. Keep the database URL only on Render. If using Render Postgres, use its internal URL with the backend in the same region. Render supplies `PORT` automatically; the server now reads it and binds to `0.0.0.0`. Leave `ONLINE_PORT` unset.

After deployment, `https://foh.onrender.com/health` should return JSON with `ok: true`, `persistence: postgresql`, and `mode: online`. API requests other than health checks go through the Vercel proxy; browsing the Render root URL is not the application login.

## Vercel project

Root Directory: `apps/boh-dashboard`. Build Command: `npm run build` (the app prebuild handles the shared package).

Set these for the Production environment, then redeploy:

```dotenv
EXA_DEPLOYMENT_MODE=online
TENANT_ROUTING_MODE=single-host
TENANT_BASE_DOMAIN=foh-rouge.vercel.app
WORKSPACE_PUBLIC_ORIGIN=https://foh-rouge.vercel.app
ONLINE_INTERNAL_URL=https://foh.onrender.com
ONLINE_PROXY_SECRET=<the same generated secret as Render>
```

No separate CORS configuration is required: the browser calls Vercel's own `/api/manage/...` endpoints, and Vercel connects to Render server-side. Do not set a browser-visible API secret or expose `DATABASE_URL` through `NEXT_PUBLIC_`.

## Workspace flow without subdomains

- Signup: `https://foh-rouge.vercel.app/signup`
- Business login: `https://foh-rouge.vercel.app/login?workspace=gwx`
- Workspace finder/switcher: `https://foh-rouge.vercel.app/login?central=1`
- Public guest menu: `/order/<storefront-id>?workspace=gwx` (the Storefront's **Guest menu** link includes the workspace automatically).

Successful login sets an HttpOnly workspace-selector cookie alongside the HttpOnly session cookie. The selector is not authorization: every authenticated request still verifies that the session belongs to that business. This temporary single-host mode has one active workspace session per browser cookie jar. Independent simultaneous workspace sessions can use separate browser profiles. Subdomain mode keeps the original per-subdomain cookies when a custom domain is configured later.

To move to a custom domain, use `TENANT_ROUTING_MODE=subdomain`, a base such as `yourdomain.com`, and `https://app.yourdomain.com` for both public-origin settings. Configure the custom/wildcard domains with Vercel and retain the shared proxy secret.
