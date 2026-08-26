# Deploying Mastra Server + Studio to Coolify

One Coolify application serving both the Mastra API and the Studio UI from the same
Node container. Built with `mastra build --studio`, protected with Traefik basic auth.

Verified against `mastra@1.26`, `@mastra/core@1.61`, Coolify v4.3.x, Node 22.

---

## What's in this repo

| File | Purpose |
|---|---|
| `Dockerfile` | Two-stage build. Stage 1 runs `mastra build --studio`; stage 2 is a slim runtime that serves API + Studio on port 4111. |
| `src/mastra/index.ts` | Mastra instance. Binds `0.0.0.0`, reads `PORT`, configures CORS, timeouts, storage, optional API-key auth. |
| `src/mastra/agents/support-agent.ts` | Placeholder agent so the build has something to serve. Replace with yours. |
| `.env.example` | Every env var the app reads. Copy the values into Coolify. |
| `docker-compose.yaml` | Local smoke test, and an alternative Coolify build pack. |
| `.dockerignore` | Keeps `node_modules`, `.mastra` and `data` out of the build context. |

---

## Step 1 — Push to Git

```bash
git init
git add .
git commit -m "Mastra server + Studio, Coolify deployment"
git branch -M main
git remote add origin git@github.com:YOUR-ORG/YOUR-REPO.git
git push -u origin main
```

`.env` is gitignored. Secrets go into Coolify, never into the repo.

---

## Step 2 — Create the Coolify application

In your `mastra` project → `production` environment → **+ New** → **Choose a resource**:

- Pick **Git Repository (with GitHub App)** — gives you webhook-driven auto-deploy on push.
- Public repo without a GitHub App? **Public Git Repository** works, but you deploy manually.
- Do **not** pick "Dockerfile" or "Docker Compose" from that screen — those are for deploying
  without a Git repo, and you lose auto-deploy.

Then in the application settings:

| Setting | Value |
|---|---|
| Build Pack | **Dockerfile** |
| Dockerfile Location | `/Dockerfile` |
| Base Directory | `/` |
| Ports Exposes | `4111` |
| Ports Mappings | *leave empty* — mapping to the host disables rolling updates |
| Branch | `main` |

---

## Step 3 — Environment variables

**Configuration → Environment Variables.** Mark the API keys as **Build Variable? No** —
they're only needed at runtime, and keeping them out of the build layer keeps them out of
the image.

```
OPENAI_API_KEY=sk-...
PORT=4111
MASTRA_HOST=0.0.0.0
MASTRA_STUDIO_PATH=/app/.mastra/output/studio
MASTRA_DB_URL=file:/app/data/mastra.db
MASTRA_CORS_ORIGIN=https://studio.yourdomain.com
MASTRA_TELEMETRY_DISABLED=1
LOG_LEVEL=info
```

Optional, recommended as a second layer:

```
MASTRA_API_KEY=<long random string>
```

With it set, Studio shows a login screen and every `/api/*` call needs
`Authorization: Bearer <key>`. Generate one with `openssl rand -hex 32`.

---

## Step 4 — Persistent storage

The SQLite database lives at `/app/data/mastra.db`. Without a volume it is wiped on every
redeploy, taking agent memory and traces with it.

**Storages → + Add → Volume Mount**

| Field | Value |
|---|---|
| Name | `mastra-data` |
| Destination Path | `/app/data` |

Outgrowing SQLite (multiple replicas, or you want managed backups) means swapping
`@mastra/libsql` for `@mastra/pg` and pointing `MASTRA_DB_URL` at a Postgres/Supabase
connection string. Coolify can host the Postgres too — add it as a database resource in the
same project and use its internal hostname.

---

## Step 5 — Domain and SSL

**Configuration → Domains:** `https://studio.yourdomain.com`

Point an A record at your Coolify server's IP first. Coolify provisions the Let's Encrypt
certificate on the next deploy. Keep the `https://` prefix — without it Coolify won't set up TLS.

---

## Step 6 — Health check

**Configuration → Health Checks**

| Field | Value |
|---|---|
| Enabled | on |
| Path | `/health` |
| Port | `4111` |
| Method | `GET` |
| Expected Status | `200` |
| Interval | `30` |
| Timeout | `10` |
| Retries | `3` |
| Start Period | `30` |

`/health` returns `{"success":true}`. One caveat from the Coolify docs: Traefik will not
route to a container whose health check is failing — so if the app 502s after a deploy,
check the health check config before anything else.

---

## Step 7 — Basic auth

Studio has full control over your agents, workflows and tools. Anyone who reaches the domain
can run them. Lock it down before you point DNS at it.

Generate a bcrypt hash on any machine with Apache utils:

```bash
htpasswd -nbB admin 'your-strong-password'
# admin:$2y$05$Xk...
```

No `htpasswd`? On the Coolify server:

```bash
docker run --rm httpd:alpine htpasswd -nbB admin 'your-strong-password'
```

**Configuration → Advanced → Labels.** Coolify has already generated labels there, including
your router names (they look like `http-0-<uuid>` and `https-0-<uuid>`). Append:

```
traefik.http.middlewares.mastraauth.basicauth.users=admin:$2y$05$Xk...
traefik.http.routers.https-0-<uuid>.middlewares=mastraauth
```

Three things that trip people up here:

1. Use the **actual router name** Coolify generated, not a placeholder.
2. If that router already has middlewares listed (`gzip`, `redirect-to-https`), append to the
   list rather than replacing it: `middlewares=gzip,mastraauth`.
3. Dollar signs in the bcrypt hash. In the plain Labels field, paste the hash as-is. In a
   `docker-compose.yaml` label you must escape them — `\$` inside double quotes, or `$$`.
   A hash that silently fails to authenticate is almost always an escaping problem.

Redeploy after changing labels — Coolify only reapplies them on deploy.

---

## Step 8 — Deploy and verify

Hit **Deploy**. First build takes 3–6 minutes (the `mastra build` bundle step plus a
production `npm install` inside `.mastra/output`).

```bash
# basic auth challenge — expect 401
curl -I https://studio.yourdomain.com/

# health through basic auth — expect 200 {"success":true}
curl -u admin:'your-strong-password' https://studio.yourdomain.com/health

# API listing — 401 if MASTRA_API_KEY is set, 200 if not
curl -u admin:'your-strong-password' https://studio.yourdomain.com/api/agents

# with the API key
curl -u admin:'your-strong-password' \
     -H "Authorization: Bearer $MASTRA_API_KEY" \
     https://studio.yourdomain.com/api/agents
```

Then open `https://studio.yourdomain.com` in a browser. Basic auth prompt → Studio loads →
your agent is listed under Agents.

---

## Local development

```bash
cp .env.example .env      # add OPENAI_API_KEY
npm install
npm run dev               # Studio + API on http://localhost:4111
```

Test the production path before pushing:

```bash
npm run build
MASTRA_STUDIO_PATH=.mastra/output/studio npm start
```

Or the container itself:

```bash
docker compose up --build
```

---

## Troubleshooting

**Build OOMs on the Coolify server.** The Rollup bundle step is memory-hungry. The Dockerfile
already sets `NODE_OPTIONS=--max-old-space-size=4096`; raise it, or add
`ENV MASTRA_CONCURRENCY=2` to the builder stage to reduce parallelism. A 2 GB VPS will
struggle — 4 GB is a realistic floor.

**502 after a successful deploy.** Three usual causes, in order of likelihood: the health
check is failing (Traefik refuses to route to unhealthy containers); `Ports Exposes` is not
`4111`; or the server bound to `localhost` instead of `0.0.0.0` — confirm `MASTRA_HOST` is set.

**Studio loads but shows the "enter your Mastra instance URL" form.** `MASTRA_STUDIO_PATH`
isn't pointing at the built assets, so you're getting the standalone Studio rather than the
server-hosted one. It must be `/app/.mastra/output/studio` in the container.

**Studio loads but the API calls fail with CORS errors.** `MASTRA_CORS_ORIGIN` doesn't include
the domain you're browsing from. Same-origin (API and Studio on one domain) shouldn't need
this at all — if it does, something is proxying the API elsewhere.

**Agent runs time out at ~180s.** Raise `MASTRA_REQUEST_TIMEOUT`. Coolify's Traefik also has
its own timeouts for very long runs; for anything over a few minutes, prefer async workflow
runs over a single held-open request.

**Data disappears after redeploy.** The volume mount at `/app/data` is missing or the
destination path doesn't match `MASTRA_DB_URL`.

---

## Sources

- [Mastra — Studio deployment](https://mastra.ai/docs/studio/deployment)
- [Mastra — Mastra server](https://mastra.ai/docs/deployment/mastra-server)
- [Mastra — Studio auth](https://mastra.ai/docs/studio/auth)
- [Mastra — Configuration reference](https://mastra.ai/reference/configuration)
- [Coolify — Applications](https://coolify.io/docs/applications)
- [Coolify — Traefik basic auth](https://coolify.io/docs/knowledge-base/proxy/traefik/basic-auth)
