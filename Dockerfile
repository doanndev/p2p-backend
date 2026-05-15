# syntax=docker/dockerfile:1
#
# Env at runtime: docker run --env-file ... (CI/CD staging) or -e / compose env.
# Do not bake .env into the image (secrets must not be in registry layers).

FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8000
ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache

COPY package.json yarn.lock ./
RUN corepack enable \
  && yarn install --frozen-lockfile --production=true \
  && yarn cache clean \
  && rm -rf /tmp/.yarn-cache /root/.cache /tmp/*

COPY --from=builder /app/dist ./dist

EXPOSE 8000

CMD ["node", "dist/main.js"]
