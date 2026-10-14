# syntax=docker/dockerfile:1.7

# ---------------------------------------------------------------------
# service-finder-backend — one Dockerfile, one image per app
#
#   docker build .                            apps/api (the default)
#   docker build --build-arg APP=<name> .     any other app under apps/
#
# Each app is its own workspace package with its own dependencies, and
# `pnpm deploy` installs only that package's production dependency tree
# — so an image never carries another app's packages. What it copies is
# the app's package.json "files" (for the API, dist/) plus node_modules,
# where the workspace packages the app uses (@service-finder/db and
# friends) land as ordinary dependencies with their own dist/. The
# migrations travel inside @service-finder/db, beside the schema they
# were generated from: the migrator finds them relative to the package,
# not the working directory.
#
# So the runtime layout is /app/dist, /app/node_modules and
# /app/package.json, and the commands in deploy/ecs/*.json and
# deploy/run-task.sh are unchanged. The API's entry points all live in
# its image, because they are the same application and must never
# disagree about the schema:
#
#   node dist/index.js                         the API
#   node dist/db/migrate.js                    the deploy migration
#   node dist/modules/auth/auth.seed.js        seeds (see deploy/run-task.sh)
#
# The last two are `tsx src/...` in package.json for local use; compiled,
# they need no tsx and no source, which is why the runtime stage carries
# neither.
#
# A second app — a realtime server, a queue worker — is the same shape:
# its own apps/<name>/package.json, `node dist/index.js`, its own much
# smaller dependency tree, and the same entrypoint for its environment.
# ---------------------------------------------------------------------

FROM node:22-bookworm-slim AS base
# HUSKY=0: the root package.json's "prepare": "husky" runs on install and
# has no .git and no husky to find inside a build context. This is
# husky's own documented off switch — quieter than stripping the script.
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH HUSKY=0
RUN corepack enable
WORKDIR /repo

FROM base AS build
# Every dependency in the lockfile, fetched before any source is copied:
# a code change reuses this layer instead of downloading the world again.
# package.json comes too, because corepack reads the pnpm version from it.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm fetch
# Declared after the fetch, so every app's image shares that layer: a
# build argument changes every RUN after it.
ARG APP=api
COPY . .
# The app and the workspace packages it depends on ("…"), nothing else,
# from the same lockfile the pipeline checked.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --offline --filter "@service-finder/${APP}..."
# The workspace packages first, then the app ("…" again — pnpm runs them
# in dependency order). Plain tsc: every entry point above comes out of
# this one compile, so the API and the migration can never be built from
# different source.
RUN pnpm --filter "@service-finder/${APP}..." build
# Production dependencies only, into a self-contained /out. Workspace
# packages are injected — copied in, with only their package.json "files"
# — rather than linked back to /repo, which the runtime stage doesn't
# have. Turned on for this one command, not in pnpm-workspace.yaml, so
# local development keeps plain links and sees a package's changes at
# once. pnpm's own lockfile and workspace file for /out are dropped: the
# runtime stage only needs what node loads.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --config.inject-workspace-packages=true --filter "@service-finder/${APP}" \
        deploy --prod --offline /out \
    && rm -f /out/pnpm-lock.yaml /out/pnpm-workspace.yaml

FROM node:22-bookworm-slim AS runtime

# The entrypoint writes .env from AWS Secrets Manager before node starts,
# which is what keeps the application itself free of any AWS SDK: it goes
# on reading .env through dotenv exactly as it does on a laptop. That
# needs the AWS CLI and jq in the runtime image — the one real cost of
# this approach, most of it Python behind the CLI. `docker images` after
# a build will tell you what it came to.
RUN apt-get update \
    && apt-get install -y --no-install-recommends awscli jq ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

# Aurora requires TLS (rds.force_ssl defaults to 1 from engine 16), and
# Amazon's root CAs are not in Node's trust store — so a connection can
# only be both encrypted AND verified if the bundle travels with the
# image. Every region's CA is in this one file, so a task in any region
# uses the same path. packages/db/src/ssl.ts reads it when
# DATABASE_CA_BUNDLE_PATH points here, which the task definitions set and
# a local docker-compose run does not.
# ADD from a URL writes the file 0600 root:root — unlike ADD from the
# build context, which writes 0644 — so the unprivileged `node` user this
# image runs as cannot open it. chmod as a separate RUN rather than
# ADD --chmod, which only exists under BuildKit.
ADD https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    /etc/ssl/rds/global-bundle.pem
# The directory too, not just the file: ADD creates missing parents, and
# this does not depend on which mode it picks for them. The grep fails the
# build if that URL ever answers with something that is not a certificate
# bundle — an error page downloads just as successfully as a PEM.
RUN chmod 0755 /etc/ssl/rds \
    && chmod 0644 /etc/ssl/rds/global-bundle.pem \
    && grep -q 'BEGIN CERTIFICATE' /etc/ssl/rds/global-bundle.pem

# TZ: every timestamp in this codebase is timestamptz, and any local wall
# clock is applied from the place's own timezone on the way out (see
# packages/db/src/schema/_helpers.ts). The container's own zone should
# therefore be UTC and stay there, so a task placed in a different region
# cannot quietly change which calendar day a 1am event falls on.
# PORT: 3000 inside the container, the same as iGroom's image, so a load
# balancer and target group copied from iGroom's infrastructure fit
# unchanged. 4000 is only the local-dev default (see config/env.ts).
ENV NODE_ENV=production PORT=3000 TZ=UTC
# Owned by node, because the entrypoint writes .env here as that user.
RUN mkdir -p /app && chown node:node /app
WORKDIR /app

# dist/, package.json and production node_modules (the migrations among
# them, inside @service-finder/db) — see the header.
COPY --from=build --chown=node:node /out ./
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
# Root-owned and explicitly executable, rather than trusting whatever
# mode the file happened to have in the build context.
RUN chmod 755 /usr/local/bin/docker-entrypoint.sh

# The node image ships an unprivileged `node` user.
USER node

# Read the bundle as the user that will actually read it at runtime. The
# first attempt at this shipped a 0600 root-owned file, which built and
# pushed cleanly and then failed in a migration task — a build-time check
# costs nothing and cannot be skipped the way a code review can.
RUN node -e "require('node:fs').readFileSync('/etc/ssl/rds/global-bundle.pem')"

EXPOSE 3000

# Everything goes through the entrypoint, which fetches the environment
# and then execs the command below — so the migration and seed tasks get
# their configuration the same way the API does, from the one command
# override in their task definitions.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Health checking lives in the task definition rather than here, so the
# ALB target group and the container check are configured in one place.
CMD ["node", "dist/index.js"]
