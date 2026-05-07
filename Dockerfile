# syntax=docker/dockerfile:1
#
# Build yêu cầu file .env trong context ./backend (gitignore — chỉ có trên máy build).
# File được COPY vào image → Nest ConfigModule đọc /app/.env lúc chạy.
# Deploy kiểu một tar: docker save → VPS docker load → docker run / compose (không cần copy .env ra host).
# CẢNH BÁO: không push image/tar có .env thật lên registry công khai; coi tar như secret.

FROM node:20-bookworm-slim AS builder

WORKDIR /app

COPY package.json yarn.lock ./
RUN corepack enable && yarn install --frozen-lockfile

COPY . .
RUN yarn build

FROM node:20-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8012
ENV YARN_CACHE_FOLDER=/tmp/.yarn-cache

COPY package.json yarn.lock ./
RUN corepack enable \
  && yarn install --frozen-lockfile --production=true \
  && yarn cache clean \
  && rm -rf /tmp/.yarn-cache /root/.cache /tmp/*

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env ./.env

EXPOSE 8012

CMD ["node", "dist/main.js"]
