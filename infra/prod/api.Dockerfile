# syntax=docker/dockerfile:1
#
# Production image of the API: compiled JavaScript and production dependencies only, run as the
# unprivileged `node` user. Build from the repository root:
#
#   docker build -f infra/prod/api.Dockerfile -t ruta-limpia/api .
#
# Commands (no tsx, no pnpm at runtime):
#   node dist/main.js                                    the API (default)
#   node dist/shared/infrastructure/db/cli.js migrate    apply pending migrations
#   node dist/shared/infrastructure/db/cli.js seed       load the pilot catalog (idempotent)
#   node dist/auth/infrastructure/user-cli.js ...        create a panel user (password on stdin)
#   node dist/alerts/infrastructure/vapid-keys-cli.js    print a new VAPID key pair

ARG NODE_IMAGE=node:22-alpine

FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /repo
# Manifests first, so the dependency layer is cached until a manifest or the lockfile changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY tools/simulator/package.json tools/simulator/
RUN pnpm install --frozen-lockfile --filter @ruta-limpia/api...
COPY tsconfig.base.json ./
COPY apps/api apps/api
RUN pnpm --filter @ruta-limpia/api build \
  && pnpm --filter @ruta-limpia/api deploy --prod --legacy /out

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
WORKDIR /app
# Owned by root and read-only for the `node` user that runs the process.
COPY --from=build /out/package.json ./package.json
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
