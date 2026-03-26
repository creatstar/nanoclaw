#!/bin/bash
# start-nanoclaw.sh — Start NanoClaw without systemd
# To stop: kill \$(cat /home/andy/work/nanoclaw/nanoclaw.pid)

set -euo pipefail

cd "/home/andy/work/nanoclaw"

# Stop existing instance if running
if [ -f "/home/andy/work/nanoclaw/nanoclaw.pid" ]; then
  OLD_PID=$(cat "/home/andy/work/nanoclaw/nanoclaw.pid" 2>/dev/null || echo "")
  if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
    echo "Stopping existing NanoClaw (PID $OLD_PID)..."
    kill "$OLD_PID" 2>/dev/null || true
    sleep 2
  fi
fi

echo "Starting NanoClaw..."
nohup "/home/andy/.nvm/versions/node/v20.20.0/bin/node" "/home/andy/work/nanoclaw/dist/index.js" \
  >> "/home/andy/work/nanoclaw/logs/nanoclaw.log" \
  2>> "/home/andy/work/nanoclaw/logs/nanoclaw.error.log" &

echo $! > "/home/andy/work/nanoclaw/nanoclaw.pid"
echo "NanoClaw started (PID $!)"
echo "Logs: tail -f /home/andy/work/nanoclaw/logs/nanoclaw.log"
