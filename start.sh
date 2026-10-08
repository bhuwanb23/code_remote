#!/bin/bash

export OPENCODE_SERVER_PASSWORD=mypassword

exec opencode serve \
  --hostname 0.0.0.0 \
  --port ${PORT:-10000}
