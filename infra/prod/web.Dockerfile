# syntax=docker/dockerfile:1
#
# Production web server: Caddy with automatic HTTPS, serving the built web app (citizen PWA at
# `/`, municipal panel at `/panel`) and proxying the API (see infra/prod/Caddyfile). Build from
# the repository root:
#
#   docker build -f infra/prod/web.Dockerfile -t ruta-limpia/web .

ARG NODE_IMAGE=node:22-alpine
ARG CADDY_IMAGE=caddy:2.10-alpine

FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tools/simulator/package.json tools/simulator/
RUN pnpm install --frozen-lockfile --filter @ruta-limpia/web...
COPY tsconfig.base.json ./
COPY apps/web apps/web
RUN pnpm --filter @ruta-limpia/web build

FROM ${CADDY_IMAGE} AS runtime
COPY infra/prod/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /repo/apps/web/dist /srv
