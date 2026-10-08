#!/bin/bash

PORT=${PORT:-10000}

exec ttyd \
  --writable \
  -p $PORT \
  bash