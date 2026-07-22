# Staging deploy — AC-QMS (branch: staging)

Deploy **only** from the `staging` branch on each repo. Connect Render / Vercel / Neon to `staging` so every push auto-redeploys.

## Repos & branches

| Repo | GitHub | Deploy branch |
|------|--------|---------------|
| API Gateway | `AC-QMS-API-Gateway` | `staging` |
| DOC-Module | `AC-QMS-DOC-Module` | `staging` |
| Frontend | `AC-QMS-Frontend-Next` | `staging` |

## Hosting layout (free / low-cost)

| Service | Host | Branch | Notes |
|---------|------|--------|-------|
| Postgres | Neon free | — | Persistent `DATABASE_URL` |
| DOC-Module | Render **Docker** | `staging` | Dockerfile includes LibreOffice → PDF works |
| API Gateway | Render **Docker** | `staging` | Dockerfile runs migrate + `tsx src/server.ts` |
| Frontend | Vercel | `staging` | Client URL |

## 1. DOC-Module (Render Docker)

- Root directory: repo root
- Dockerfile path: `Dockerfile`
- Branch: `staging`
- Env:

```env
API_KEY=<same-secret-as-gateway>
DEBUG=false
LIBREOFFICE_PATH=soffice
```

- Health: `GET /health` (or `/docs`)
- Copy public URL → use as Gateway `DOC_MODULE_URL`

## 2. API Gateway (Render Docker)

- Branch: `staging`
- Env:

```env
DATABASE_URL=<neon-url>
JWT_SECRET=<random-32+-chars>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=10h
BCRYPT_ROUNDS=12
PORT=4000
NODE_ENV=production
CORS_ORIGIN=https://<your-vercel-app>.vercel.app
DOC_MODULE_URL=https://<doc-module>.onrender.com
DOC_MODULE_API_KEY=<same-as-DOC-Module-API_KEY>
DOCUMENT_STORAGE_ROOT=/app/storage/documents
DOC_MODULE_PDF_OPTIONAL=false
```

- After first deploy, seed once (Render Shell):

```bash
npx tsx prisma/seed.ts
```

- Optional: attach a persistent disk at `/app/storage/documents` so DOCX/PDF survive redeploys.

## 3. Frontend (Vercel)

- Framework: Next.js
- Branch: `staging` (Production Branch = `staging` for this project, or use a Staging environment)
- Env:

```env
NEXT_PUBLIC_API_BASE_URL=https://<api-gateway>.onrender.com/api/v1
NEXT_PUBLIC_DEMO_AUTH=false
API_PROXY_TARGET=https://<api-gateway>.onrender.com
```

`API_PROXY_TARGET` is used by `next.config.mjs` rewrites when the browser calls same-origin `/api/v1`. Prefer setting `NEXT_PUBLIC_API_BASE_URL` to the **full Gateway URL** for staging so the browser talks to the API directly (and set `CORS_ORIGIN` accordingly).

## Client link

Share the **Vercel URL**, e.g. `https://ac-qms-staging.vercel.app`

Seed logins (dev password): `rajesh.kumar` / `Acqms@2026` (and other seeded users).

## LibreOffice / PDF

DOC-Module staging image installs `libreoffice-writer`. Gateway with `DOC_MODULE_PDF_OPTIONAL=false` expects PDF conversion to succeed. First cold start after Render sleep can take 30–60s.

## Workflow

1. Develop on `rajdeep_dev` (or feature branches).
2. Merge into `staging` when ready to demo.
3. Push `staging` → Render/Vercel auto-deploy.
4. Promote to `main` only when ready for a more stable release.

Do **not** commit real `.env` secrets; set them in the host dashboard.
