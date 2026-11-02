# syntax=docker/dockerfile:1.7
# One build, four images: api (and its migrate job), studio, runtime and capi.
#   docker build --target api -t zapx-api .
#   docker build --target studio -t zapx-studio .
#   docker build --target runtime -t zapx-runtime .
#   docker build --target capi -t zapx-capi .
# The same images run locally under docker compose and on AWS ECS/Fargate.

FROM node:26-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY . .
RUN pnpm install --frozen-lockfile
# The studio proxies /api to this address; it is fixed at build time by Next.js rewrites.
ARG ZAPX_API_URL=http://api:4000
ENV ZAPX_API_URL=$ZAPX_API_URL
RUN pnpm build

# ---- API -------------------------------------------------------------------------------------
FROM base AS api
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
# Local file store (FILES_DIR), shared with the worker through a volume. On AWS, FILE_STORE=s3 is used instead.
ENV FILES_DIR=/data/files
RUN mkdir -p /data/files && chown -R node:node /data
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --retries=6 CMD node -e "fetch('http://localhost:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/main.js"]

# One-off job: apply database migrations, then exit (an ECS task before each deployment).
FROM api AS migrate
HEALTHCHECK NONE
# Accepts DATABASE_URL or the DB_* parts (apps/api/src/database-url.ts), like the API.
CMD ["node", "apps/api/dist/cli/migrate.js"]

# Background worker: jobs (exports, large QA runs, AI drafts), vendor callbacks and webhooks.
FROM api AS worker
HEALTHCHECK NONE
CMD ["node", "apps/api/dist/worker.js"]

# ---- Studio ----------------------------------------------------------------------------------
FROM base AS studio
ENV NODE_ENV=production
COPY --from=build --chown=node:node /app /app
USER node
WORKDIR /app/apps/studio
EXPOSE 3000
CMD ["node_modules/.bin/next", "start", "-p", "3000"]

# ---- Respondent runtime: static files plus an /api proxy (CloudFront + S3 + ALB on AWS) -------
FROM nginx:1.27-alpine AS runtime
COPY infra/nginx/runtime.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/runtime-headers.conf /etc/nginx/snippets/runtime-headers.conf
COPY --from=build /app/apps/runtime/dist /usr/share/nginx/html
EXPOSE 80

# ---- Offline interviewer app (CAPI): static files plus an /api proxy --------------------------
FROM nginx:1.27-alpine AS capi
COPY infra/nginx/capi.conf /etc/nginx/conf.d/default.conf
COPY infra/nginx/capi-headers.conf /etc/nginx/snippets/capi-headers.conf
COPY --from=build /app/apps/capi/dist /usr/share/nginx/html
EXPOSE 80
