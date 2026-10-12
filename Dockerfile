# syntax=docker/dockerfile:1

# The deployable Loam backend (server/index.ts). Frontend and WhatsApp are NOT
# in this image -- the frontend is static hosting, and the Baileys service is a
# separate process with its own session volume.
#
# WHY TWO STAGES
#   `npm run build:server` imports `esbuild`, which is a devDependency. The
#   running server needs none of that: the bundle inlines everything except
#   `@supabase/supabase-js`, which `scripts/build-server.mjs` leaves external
#   on purpose. So the build stage installs the full lockfile and the runtime
#   stage installs production dependencies only, and esbuild plus the whole
#   React toolchain stay out of the shipped image.
#
# NODE VERSION
#   `scripts/build-server.mjs` targets `node20`, and `src/lib/loam/model/hosted.ts`
#   uses `AbortSignal.any` (Node 20.3+). 22 is the current LTS and satisfies
#   both. `package.json` declares no `engines` field, so this is the first
#   place the runtime is pinned.

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------
FROM node:22-slim AS build

WORKDIR /app

# Dependencies first, so a source-only change does not re-resolve the tree.
# `npm ci` uses the committed package-lock.json exactly as it stands.
COPY package.json package-lock.json ./
RUN npm ci

# Only what the bundler actually reads. `server/index.ts` is the entry point;
# `src/` is reachable through the `@/` alias the build script resolves.
COPY tsconfig.json ./
COPY scripts/build-server.mjs ./scripts/build-server.mjs
COPY server ./server
COPY src ./src

# The repository's own script, not a reimplementation of it. It also fails the
# build if the production guard in select.ts is missing from the bundle.
RUN npm run build:server

# ---------------------------------------------------------------------------
# Runtime
# ---------------------------------------------------------------------------
FROM node:22-slim AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Production dependencies from the same lockfile.
#
# NOTE: this installs every entry under `dependencies`, which in this
# repository includes frontend packages (react, leaflet, recharts). The server
# needs only `@supabase/supabase-js`. Narrowing it would mean editing
# package.json, which is out of scope here, so the image carries some unused
# modules. It is correctness-neutral and costs image size only.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev \
 && npm cache clean --force

# The built bundle, and nothing else from the build stage.
COPY --from=build /app/dist-server ./dist-server

# Defaults matching server/index.ts: `Number(env.PORT) || 8787` and
# `env.HOST || '0.0.0.0'`. Set explicitly so the container's binding is
# visible here rather than implied by the code.
#
# NOT set here, deliberately: LOAM_ENV, LOAM_HOSTED_*, LOAM_ALLOWED_ORIGINS,
# VITE_SUPABASE_*. Those belong in `fly secrets` / platform configuration.
# `LOAM_HOSTED_TOKEN` is a credential and must never appear in an image layer.
ENV PORT=8787 \
    HOST=0.0.0.0

EXPOSE 8787

# Drop root. The process only reads from /app and writes nothing to disk.
USER node

# `npm run start:server` would work, but calling node directly means signals
# reach the server rather than npm -- and server/index.ts installs SIGTERM and
# SIGINT handlers to drain in-flight turns, which a long Loam answer needs.
CMD ["node", "dist-server/loam-server.mjs"]
