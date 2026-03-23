FROM node:20-bookworm-slim AS builder

WORKDIR /app

# Install dependencies (including dev deps for build step)
COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile

# Build app
COPY . .
RUN yarn build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=10000
ENV APP_PORT=10000
ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache

# Install production dependencies only
COPY package.json yarn.lock ./
RUN corepack enable \
  && yarn install --frozen-lockfile --production=true \
  && yarn cache clean \
  && rm -rf /tmp/.yarn-cache /root/.cache /tmp/*

# Copy build output
COPY --from=builder /app/dist ./dist

# Render provides PORT dynamically; default exposed for local docker run
EXPOSE 10000

CMD ["node", "dist/main.js"]
