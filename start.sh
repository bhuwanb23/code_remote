#!/bin/bash

echo "Starting OpenCode..."
echo "PORT=$PORT"

unset OPENCODE_SERVER_PASSWORD

exec opencode serve \
  --hostname 0.0.0.0 \
  --port ${PORT:-10000}