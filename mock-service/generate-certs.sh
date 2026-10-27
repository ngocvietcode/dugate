#!/bin/sh
# mock-service/generate-certs.sh
# Generates the self-signed TLS pair the mock service listens with.
#
# Runs at container start (see docker-entrypoint.sh), NOT at image build time, so
# the private key never lands in an image layer or in the repo. Idempotent: if a
# pair already exists it is reused, which keeps NODE_EXTRA_CA_CERTS in the app and
# worker containers valid across mock-service restarts.
#
# SAN carries both names on purpose:
#   DNS:mock-service -> how app/worker reach it inside the compose network
#   DNS:localhost    -> how a developer reaches it from inside the container
set -eu

CERT_DIR="${MOCK_CERT_DIR:-/certs}"
KEY_PATH="${MOCK_TLS_KEY:-$CERT_DIR/mock-service.key}"
CERT_PATH="${MOCK_TLS_CERT:-$CERT_DIR/mock-service.crt}"
DAYS="${MOCK_CERT_DAYS:-3650}"

mkdir -p "$CERT_DIR"

if [ -f "$KEY_PATH" ] && [ -f "$CERT_PATH" ]; then
  echo "[mock-service] TLS pair already present at $CERT_DIR — reusing."
  exit 0
fi

echo "[mock-service] Generating self-signed TLS pair in $CERT_DIR (${DAYS}d)..."
openssl req -x509 \
  -newkey rsa:2048 \
  -nodes \
  -sha256 \
  -days "$DAYS" \
  -keyout "$KEY_PATH" \
  -out "$CERT_PATH" \
  -subj "/CN=mock-service" \
  -addext "subjectAltName=DNS:mock-service,DNS:localhost,IP:127.0.0.1" \
  >/dev/null 2>&1

# Key stays owner-only; cert is world-readable so the app/worker containers can
# load it as an extra CA through the shared volume.
chmod 600 "$KEY_PATH"
chmod 644 "$CERT_PATH"

echo "[mock-service] Done: $CERT_PATH"
