# Sử dụng Node.js LTS
FROM node:22-alpine AS builder

# Đặt thư mục làm việc
WORKDIR /app

# Copy package.json trước để tận dụng cache
COPY package*.json ./

# Cài đặt chỉ các dependencies cần thiết
RUN npm install --omit=dev --legacy-peer-deps

# Copy toàn bộ source code vào container
COPY . .  

# Build NestJS
RUN npm run build

# Stage 2: Chạy ứng dụng trong image nhỏ gọn hơn
FROM node:22-alpine AS runner

# Cập nhật index rồi cài build tools (tránh lỗi DNS / no such package)
RUN apk update && apk add --no-cache python3 make g++ libc6-compat

# Đặt thư mục làm việc
WORKDIR /app

# Copy file cần thiết từ stage build
COPY --from=builder /app/package.json /app/package-lock.json ./
COPY --from=builder /app/dist ./dist

# Copy file .env vào container (nếu có)
COPY --from=builder /app/.env* ./

# Cài đặt lại dependencies để build native modules cho platform đúng
RUN npm ci --omit=dev --legacy-peer-deps && \
    npm cache clean --force

# Xóa build tools sau khi cài đặt để giảm kích thước image
RUN apk del python3 make g++

# Expose cổng chạy server
EXPOSE 8100

# Chạy ứng dụng
CMD ["node", "dist/main.js"]