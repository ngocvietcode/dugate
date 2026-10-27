# =========================================================
# Registry/Proxy parameters (override theo UAT/LIVE)
# =========================================================
ARG DOCKERHUB_PROXY_REGISTRY=dockerhub-proxy.aws.platform.vpbank.dev
ARG NPM_PROXY_REGISTRY=https://registry.aws.platform.vpbank.dev/repository/npm-proxy-group
# Base image is pulled from the trusted VPBank proxy registry (mitigates
# dependency confusion). Pinned by digest (not the mutable :20-slim tag) to fully
# close the Fortify High "Dependency Confusion" finding. The digest below is the
# multi-arch INDEX digest for node:20.20.2-slim (resolves per-arch via the proxy);
# keep the `library/` prefix so the pull-through proxy resolves the official image.
ARG NODE_IMAGE=library/node:20.20.2-slim@sha256:2cf067cfed83d5ea958367df9f966191a942351a2df77d6f0193e162b5febfc0
ARG IMAGE_TAG=0.0.1

# Stage 1: deps
FROM ${DOCKERHUB_PROXY_REGISTRY}/${NODE_IMAGE} AS deps
WORKDIR /app

ARG NPM_PROXY_REGISTRY
RUN npm config set registry ${NPM_PROXY_REGISTRY} \
    && npm config set strict-ssl false \
    && npm config set audit false \
    && npm config set fund false

COPY package*.json ./
RUN npm install

# Stage 2: builder
FROM ${DOCKERHUB_PROXY_REGISTRY}/${NODE_IMAGE} AS builder
WORKDIR /app

ARG NPM_PROXY_REGISTRY
RUN npm config set registry ${NPM_PROXY_REGISTRY} \
    && npm config set strict-ssl false

# NOTE: openssl is already included in node:20-slim (bookworm).
# No apt-get needed — VPBank servers cannot reach deb.debian.org.

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Bundle seed script
RUN node_modules/.bin/esbuild lib/db/seed.ts --bundle --platform=node --target=node20 --outfile=dist/seed.js

# Provide a dummy DATABASE_URL so drizzle/next build doesn't fail
ENV DATABASE_URL="postgresql://build@localhost:5432/build"

# Inject version from build arg → Next.js bakes it into NEXT_PUBLIC_APP_VERSION
ARG IMAGE_TAG
RUN if [ -n "$IMAGE_TAG" ] && [ "$IMAGE_TAG" != "latest" ]; then \
      node -e "const p=require('./package.json');p.version='${IMAGE_TAG}';require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))"; \
    fi

# NODE_TLS_REJECT_UNAUTHORIZED=0: allow Next.js to fetch fonts through proxies with self-signed certs
RUN NODE_TLS_REJECT_UNAUTHORIZED=0 npm run build

# Bundle worker.ts
#
# !! DANH SÁCH --external Ở ĐÂY PHẢI GIỐNG script "worker:build" TRONG package.json.
# worker.js bị gitignore nên bản chạy thật LÀ bản build ở dòng dưới, không phải bản dev build.
# Đã từng lệch: package.json thêm --external:pdf-parse (2026-07-31) mà Dockerfile không thêm
# → esbuild BUNDLE pdfjs-dist vào worker.js. Khi bị bundle, pdfjs mất đường dẫn tới asset của
# chính nó (cmaps/standard_fonts được resolve tương đối theo vị trí module) và `@napi-rs/canvas`
# vẫn phải require từ node_modules → nhánh đọc PDF mã hoá của financial-report vỡ.
# pdf-parse PHẢI là external để pdfjs nằm nguyên trong node_modules cùng asset của nó.
RUN node_modules/.bin/esbuild worker.ts \
    --bundle \
    --platform=node \
    --target=node20 \
    --outfile=worker.js \
    --external:ioredis \
    --external:bullmq \
    --external:mammoth \
    --external:sharp \
    --external:openai \
    --external:pdf-parse \
    --alias:@=. 2>&1 && echo "worker.js built successfully"

# Prune dev dependencies (keep typescript for drizzle-kit schema push at runtime)
#
# KHÔNG xoá cả node_modules/pdfjs-dist nữa. Từ 2026-07-31 workflow financial-report dùng
# `pdf-parse` để đọc PDF owner-password-only (3/7 file mẫu BCTC Nhật: JFE, Marubeni, Sony) và
# `pdf-parse` phụ thuộc CỨNG vào pdfjs-dist. Trước đó không ai dùng nên xoá 34.9 MB là hợp lý.
# Chỉ xoá 3 thư mục ĐÃ ĐO là không cần ở runtime (tiết kiệm 14.3 MB, còn ~20.6 MB):
#   legacy/         GIỮ — pdf-parse import đúng pdfjs-dist/legacy/build/pdf.mjs
#   cmaps/          GIỮ — CMap CJK dựng sẵn; thiếu thì render chữ Nhật SAI mà KHÔNG báo lỗi
#   standard_fonts/ GIỮ — font chuẩn cho PDF không nhúng font
#   build|web|types GIỮ LẠI LÀM GÌ — đã kiểm getInfo + getScreenshot trên cả 3 file mã hoá,
#                   ảnh render ra byte-identical khi bỏ 3 thư mục này.
RUN npm prune --production && \
    rm -rf node_modules/next node_modules/@next \
    node_modules/swagger-ui-react node_modules/@swagger-api \
    node_modules/lucide-react node_modules/@swc \
    node_modules/tailwindcss \
    node_modules/pdfjs-dist/build \
    node_modules/pdfjs-dist/web \
    node_modules/pdfjs-dist/types

# Stage 3: runner
FROM ${DOCKERHUB_PROXY_REGISTRY}/${NODE_IMAGE} AS runner
WORKDIR /app

# NOTE: No apt-get — openssl already in base image, no internet to deb.debian.org

ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/dist/seed.js ./dist/seed.js

# BullMQ Worker
COPY --from=builder /app/worker.js ./worker.js
COPY --from=builder /app/node_modules ./node_modules

# Drizzle schema sync at runtime (drizzle-kit push needs config + schema source)
COPY --from=builder /app/drizzle.config.ts ./drizzle.config.ts
COPY --from=builder /app/lib/db/schema.ts ./lib/db/schema.ts

# Writable runtime dirs. chown to the built-in non-root `node` user (uid 1000)
# so a freshly-created named volume inherits node ownership on first mount.
RUN mkdir -p uploads outputs && chown -R node:node /app/uploads /app/outputs

EXPOSE 2023
ENV PORT=2023
ENV HOSTNAME="0.0.0.0"

COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

# Run as non-root (fixes Fortify High "Dockerfile: Default User Privilege").
# node:20-slim ships a `node` user (uid/gid 1000). App binds port 2023 (>1024),
# writes only to uploads/outputs, and drizzle-kit push/seed only touch the DB —
# all safe for a non-root user.
USER node

CMD ["./docker-entrypoint.sh"]
