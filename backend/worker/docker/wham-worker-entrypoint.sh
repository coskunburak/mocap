#!/usr/bin/env sh
set -eu

cd /app/backend

if [ "${RUNPOD_SERVERLESS:-false}" = "true" ]; then
  exec "${PYTHON_PATH:-python}" worker/docker/runpod-wham-handler.py
fi

if [ "${SKIP_WHAM_PREFLIGHT:-false}" != "true" ]; then
  node dist/worker/whamDeploymentPreflight.js
fi

exec node dist/worker/index.js
