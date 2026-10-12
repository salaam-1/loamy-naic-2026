# Deploying the Loam backend

**Status: code-ready, not deployed.** Nothing in this document has been run
against a cloud account. Every claim below is either verified locally (and
says so) or is an instruction to be carried out by someone with access.

## Why this exists

Until now the entire Loam backend was a Vite plugin — `scripts/loam-dev-server.ts`,
registered with `apply: 'serve'`. That means it exists in **no deployed build**.
In production `askLoam()` POSTs `/loam/chat`, Vercel's catch-all rewrite returns
`index.html`, and the browser fails parsing HTML as JSON.

So Loam chat has never worked in production. This is not a regression to avoid;
it is the gap being closed.

## Architecture

```
                 ┌──────────────────────────┐
  browser ──────▶│ static frontend (Vercel)  │   unchanged
                 └──────────┬───────────────┘
                            │ HTTPS, Supabase JWT
                            ▼
                 ┌──────────────────────────┐
                 │ loam backend (Node)       │   NEW: server/
                 │  POST /loam/chat          │
                 │  GET  /healthz /readyz    │
                 └──────┬──────────┬────────┘
                        │          │
         anon key + caller JWT     │ server-side token
                        ▼          ▼
                  ┌──────────┐  ┌──────────────────┐
                  │ Supabase │  │ hosted AI provider│
                  │   RLS    │  └──────────────────┘
                  └──────────┘
```

The frontend, Supabase and RLS are untouched. The backend is a new deployment
target running **the same orchestrator, evidence layer and guard** as before —
`server/chat-core.ts` is shared by the dev middleware and the deployed service,
so there is one implementation, not two that drift.

### Why a persistent service, not a serverless function

A Loam turn can take minutes on a cold model and the hosted adapter's own
ceiling is 120 s. Most serverless platforms cap a request well below that, and
the adapter is built to be reused across requests rather than constructed per
invocation. Candidates: **Fly.io, Render, Railway**. A decision is still
required — see *Decisions outstanding*.

## Environment variables

Set these in the host's **secret manager**, not in a file. None is `VITE_`
prefixed, so none can reach the browser bundle.

| Variable | Required | Notes |
|---|---|---|
| `LOAM_ENV` | yes, in production | `production` makes the local-inference refusal active |
| `LOAM_PROVIDER` | no | `hosted` / `ollama`; inferred when omitted |
| `LOAM_HOSTED_MODEL` | yes (hosted) | e.g. an org/model id on the provider |
| `LOAM_HOSTED_TOKEN` | yes (hosted) | **secret** |
| `LOAM_HOSTED_BASE_URL` | no | OpenAI-compatible base; defaults to the HF router |
| `LOAM_HOSTED_TIMEOUT_MS` | no | defaults to 120 000 |
| `VITE_SUPABASE_URL` | yes | also accepted as `SUPABASE_URL` |
| `VITE_SUPABASE_ANON_KEY` | yes | also accepted as `SUPABASE_ANON_KEY`. **Anon key only** |
| `LOAM_ALLOWED_ORIGINS` | yes | comma-separated frontend origins; no wildcard |
| `PORT` / `HOST` | platform | `PORT` is supplied by the host |

**There is no service-role key here, and there must never be.** Loam builds a
per-request Supabase client from the anon key plus the *caller's own JWT*, so
every query runs as that member under RLS. A test asserts no server file
mentions `service_role`.

## It refuses to start misconfigured

Verified locally by running the built bundle under five environments — all
checks passed:

| Environment | Result |
|---|---|
| `LOAM_ENV=production`, no hosted config | **exit 1**: "Local inference (Ollama) cannot serve production traffic" |
| `LOAM_ENV=production`, `LOAM_PROVIDER=hosted`, no credentials | **exit 1**, naming `LOAM_HOSTED_MODEL` / `LOAM_HOSTED_TOKEN` |
| `LOAM_ENV=production`, `LOAM_HOSTED_BASE_URL=http://127.0.0.1:8080/v1` | **exit 1**: "is a local address" |
| `LOAM_ENV=production`, hosted configured | starts; `/healthz` 200; token value never logged |
| `LOAM_ENV=development`, nothing set | starts on Ollama — local development preserved |

A startup crash appears in a deploy log. A per-request failure looks like a
flaky model, which is why the check is at boot.

## Build and run

```bash
npm run build:server     # esbuild -> dist-server/loam-server.mjs (110 KiB)
npm run start:server     # node dist-server/loam-server.mjs
```

`build:server` fails if the production guard is missing from the bundle — a
build-time check that a local-only default has not crept into the artefact.

`esbuild` is used because it is **already installed as Vite's bundler**, so
nothing new is required. It is currently a *transitive* dependency, which is a
real fragility: run `npm install --save-dev esbuild` to pin it explicitly. That
needs authorisation, so it has not been done.

### Dockerfile

```dockerfile
FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm i --no-save esbuild
COPY . .
RUN npm run build:server
ENV NODE_ENV=production
EXPOSE 8787
CMD ["node", "dist-server/loam-server.mjs"]
```

Not written to the repo, because the host choice determines whether a
Dockerfile is even needed (Render and Railway can build from `package.json`).

### Health checks

- `GET /healthz` — liveness. Returns `{"ok":true,"service":"loam"}` and
  deliberately nothing else: no model name, no origin list, no Supabase URL.
- `GET /readyz` — readiness. 503 until Supabase is configured. Gate traffic on
  this, not on `/healthz`.

## Pointing the frontend at it

`src/lib/loam/transport.ts` posts to the relative path `/loam/chat`. In
production that resolves against the frontend's own origin, where no backend
exists.

**This is the one frontend change still required** and it is deliberately not
made yet, because it needs the deployed backend's URL:

- add `VITE_LOAM_API_BASE_URL` (public by design — it is a URL, not a secret),
- use it as a prefix in `transport.ts`, empty string in development so the Vite
  middleware keeps serving the same path,
- add the frontend origin to `LOAM_ALLOWED_ORIGINS` on the backend.

## Deploying staging — exact steps

1. Choose a host (Fly.io / Render / Railway) and create a **staging** service.
2. Set the environment variables above, with `LOAM_ENV=staging`.
3. Point `LOAM_ALLOWED_ORIGINS` at the staging frontend origin only.
4. Deploy. **Confirm the boot log** shows the provider line and
   `supabase: configured`.
5. `curl https://<backend>/healthz` → 200, and `/readyz` → 200.
6. `curl -X POST https://<backend>/loam/chat -H 'Content-Type: application/json'
   -d '{"message":"What is maize?"}'` → an answer with no private evidence
   (anonymous turn).
7. Repeat with a real `Authorization: Bearer <jwt>` and confirm the answer can
   include Level 1 evidence.
8. Add `VITE_LOAM_API_BASE_URL` to the staging frontend and redeploy it.
9. Confirm a chat turn end to end in a browser.

## Rotating credentials

`LOAM_HOSTED_TOKEN` is the only secret this service holds. Rotate by issuing a
new token at the provider, updating the host's secret, and restarting — the
adapter is constructed at boot, so a restart is required. Supabase keys rotate
through Supabase; the anon key is public by design and the service-role key is
not used here at all.

## Rollback

The backend is stateless: no migrations, no writes of its own beyond what the
orchestrator already did. Roll back by redeploying the previous image or
revision. The frontend keeps working either way — before
`VITE_LOAM_API_BASE_URL` exists it posts to its own origin, which is the
current (broken) behaviour, not a new failure.

To revert the whole extraction: delete `server/`, `scripts/build-server.mjs`,
`src/lib/loam/model/select.ts`, revert `scripts/loam-dev-server.ts`, and remove
`server` from `tsconfig.json`'s `include`. No database or external state is
involved.

## Costs

Cannot be estimated yet, and will not be guessed. What determines them:

- **Backend hosting** — a small always-on instance. Typically the low tens of
  dollars a month; the host is unchosen.
- **Hosted inference** — the dominant cost and completely unknown until a
  provider is chosen. Priced per token, so it scales with turns and with the
  system prompt's size.
- **Supabase** — unchanged by this work.

**N-ATLaS is served by no hosted provider.** I verified this four ways: an
empty `inferenceProviderMapping`, no `pipeline_tag`, absence from the HF
router's model list, and a warm-inference query returning zero against a
working control. Running N-ATLaS in the cloud therefore means **renting a GPU**,
not calling a per-token API — a materially different cost shape, and a product
decision about whether "Loam runs on N-ATLaS" stays true.

## Decisions outstanding

1. **Which hosted model.** N-ATLaS on rented GPU, or a general hosted model.
2. **Which backend host.**
3. **The frontend base-URL change**, which needs the deployed URL.

## Not in this stage

WhatsApp (still the local Baileys proof of concept) and cloud speech-to-text
(still the local Python worker) are deliberately untouched. Both were deferred
pending decisions, and neither is production-capable today.
