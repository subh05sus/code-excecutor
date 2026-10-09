#!/bin/sh
set -e
JOBS_DIR="${JOBS_DIR:-/tmp/jobs}"
mkdir -p "$JOBS_DIR"
chown executor:executor "$JOBS_DIR"
exec su-exec executor "$@"
