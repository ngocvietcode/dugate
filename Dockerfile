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

# Stage 3: runner (slim — no local PDF/DOCX processing, all done via external API)
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

# BullMQ Worker dependencies — copy full node_modules and tsconfig to resolve aliases natively
COPY --from=builder /app/worker.ts ./worker.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/node_modules ./node_modules

RUN mkdir -p uploads outputs

EXPOSE 2023
ENV PORT=2023
ENV HOSTNAME="0.0.0.0"

COPY --from=builder /app/docker-entrypoint.sh ./docker-entrypoint.sh
RUN chmod +x ./docker-entrypoint.sh

CMD ["./docker-entrypoint.sh"]
