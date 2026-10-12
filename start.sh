#!/bin/bash

echo "Starting OpenCode..."
echo "PORT=$PORT"

mkdir -p /workspace

if [ ! -d "/workspace/Learnix" ]; then
    git clone https://github.com/bhuwanb23/Learnix.git /workspace/Learnix
fi

cd /workspace/Learnix

unset OPENCODE_SERVER_PASSWORD

exec opencode serve \
    --hostname 0.0.0.0 \
    --port ${PORT}