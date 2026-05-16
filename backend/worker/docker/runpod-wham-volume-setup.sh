#!/usr/bin/env sh
set -eu

WHAM_DIR="${WHAM_REPO_DIR:-/workspace/WHAM}"

log() {
  printf '%s\n' "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    log "Missing required command: $1"
    exit 1
  fi
}

require_command git
require_command bash

if [ ! -d "$WHAM_DIR/.git" ]; then
  log "Cloning official WHAM repository into $WHAM_DIR"
  mkdir -p "$(dirname "$WHAM_DIR")"
  git clone --recursive https://github.com/yohanshin/WHAM.git "$WHAM_DIR"
else
  log "WHAM repository already exists at $WHAM_DIR"
fi

cd "$WHAM_DIR"

if [ "${FETCH_WHAM_DEMO_DATA:-false}" = "true" ]; then
  log "Running WHAM fetch_demo_data.sh. This prompts for SMPLify and SMPL credentials."
  bash fetch_demo_data.sh
else
  log "Skipping fetch_demo_data.sh. Set FETCH_WHAM_DEMO_DATA=true to download WHAM demo data, checkpoints, and SMPL assets interactively."
fi

missing=0

check_file() {
  if [ ! -f "$1" ]; then
    log "Missing file: $1"
    missing=1
  fi
}

check_dir() {
  if [ ! -d "$1" ]; then
    log "Missing directory: $1"
    missing=1
  fi
}

check_file "$WHAM_DIR/demo.py"
check_file "$WHAM_DIR/configs/yamls/demo.yaml"
check_file "$WHAM_DIR/checkpoints/wham_vit_bedlam_w_3dpw.pth.tar"
check_file "$WHAM_DIR/checkpoints/hmr2a.ckpt"
check_dir "$WHAM_DIR/dataset/body_models/smpl"

if [ "$missing" -ne 0 ]; then
  log "WHAM volume is not ready for production preflight."
  log "Run with FETCH_WHAM_DEMO_DATA=true, or copy the missing licensed assets into $WHAM_DIR."
  exit 1
fi

log "WHAM volume files are present. Run the worker preflight from /app/backend:"
log "node dist/worker/whamDeploymentPreflight.js"
