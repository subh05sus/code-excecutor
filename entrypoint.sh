#!/bin/sh
set -e
mkdir -p /tmp/jobs
chown executor:executor /tmp/jobs
exec su-exec executor "$@"
