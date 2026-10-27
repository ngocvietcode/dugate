FROM node:20-alpine

WORKDIR /app

# openssl CLI: used by generate-certs.sh at container start, not at build time.
RUN apk add --no-cache openssl

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy source code
COPY . .

RUN chmod +x /app/generate-certs.sh /app/docker-entrypoint.sh

# TLS material lives here. Created in the image (empty) and owned by `node` so the
# named volume mounted over it inherits that ownership and the non-root process can
# write the freshly generated pair. Nothing secret is baked into any layer.
RUN mkdir -p /certs && chown node:node /certs

# Environment variables
ENV MOCK_PORT=3099
ENV MOCK_API_KEY=DUMMY_SECRET_KEY
ENV MOCK_DELAY_MS=300
ENV MOCK_CERT_DIR=/certs
# Trust our own self-signed cert so the healthcheck can do a real TLS verify
# instead of disabling verification.
ENV NODE_EXTRA_CA_CERTS=/certs/mock-service.crt

# Expose port (container-internal only; docker-compose.yml deliberately does not
# publish it to the host)
EXPOSE 3099

# Run as non-root (node:20-alpine ships a `node` user, uid 1000).
USER node

# Generates the self-signed pair on first boot, then starts the server.
ENTRYPOINT ["/app/docker-entrypoint.sh"]

# Start command
CMD ["node", "server.js"]
