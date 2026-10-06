#!/bin/sh
set -e

# Default PORT to 3000 if not provided by the PaaS
export PORT="${PORT:-3000}"

# If REDIS_URL was not set, point to local Redis
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6380}"

echo "Starting Wholehearted API with embedded Redis on port ${PORT}..."

exec /usr/bin/supervisord -c /etc/supervisor/conf.d/supervisord.conf
