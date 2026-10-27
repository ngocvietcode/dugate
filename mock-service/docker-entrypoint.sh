#!/bin/sh
# mock-service/docker-entrypoint.sh
# Ensure TLS material exists, then hand off to the real command.
set -eu

/app/generate-certs.sh

exec "$@"
