#!/bin/bash

echo "Starting OpenCode..."
echo "PORT=$PORT"

export OPENCODE_SERVER_PASSWORD=test123

exec opencode serve \
  --hostname 0.0.0.0 \
  --port ${PORT:-10000}