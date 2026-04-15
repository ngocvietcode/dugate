# Stage 1: deps
FROM node:20-slim AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

# Stage 2: builder
FROM node:20-slim AS builder
WORKDIR /app

# CACHE OPTIMIZATION: Install OS packages first before copying code
RUN apt-get update -y && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules

# CACHE OPTIMIZATION: Copy prisma first and generate client
COPY prisma ./prisma
RUN npx prisma generate

# Now copy the rest of the source code
COPY . .

RUN npx tsc prisma/seed.ts --esModuleInterop --skipLibCheck --module CommonJS --target ES2022 --outDir prisma
# Provide a dummy DATABASE_URL so Prisma client initialises during static page generation
ENV DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy"
RUN npm run build
# Bundle worker.ts into a single worker.js using esbuild (handles @/ path aliases cleanly)
# esbuild is available via Next.js' own dependency tree
RUN node_modules/.bin/esbuild worker.ts \
    --bundle \
    --platform=node \
    --target=node20 \
    --outfile=worker.js \
    --external:@prisma/client \
    --external:prisma \
    --external:bcryptjs \
    --external:ioredis \
    --external:bullmq \
    --external:mammoth \
    --external:sharp \
    --external:openai \
    --alias:@=. 2>&1 && echo "worker.js built successfully"

# CACHE OPTIMIZATION: Prune dev dependencies and huge frontend libraries not needed by the worker
RUN npm prune --production && \
    rm -rf node_modules/next node_modules/@next node_modules/typescript node_modules/swagger-ui-react node_modules/@swagger-api node_modules/lucide-react node_modules/@swc node_modules/tailwindcss node_modules/pdfjs-dist

# Stage 3: runner
FROM node:20-slim AS runner
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    openssl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/node_modules/prisma ./node_modules/prisma
COPY --from=builder /app/node_modules/bcryptjs ./node_modules/bcryptjs

# BullMQ Worker — copy compiled bundle + node_modules for native addons (bcrypt, prisma)
COPY --from=builder /app/worker.js ./worker.js
COPY --from=builder /app/node_modules ./node_modules

RUN mkdir -p uploads outputs

EXPOSE 2023
ENV PORT=2023
ENV HOSTNAME="0.0.0.0"

COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN sed -i 's/\r$//' ./docker-entrypoint.sh && chmod +x ./docker-entrypoint.sh

CMD ["./docker-entrypoint.sh"]
