#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$ROOT_DIR"

echo "Checking prerequisites..."

if [ ! -f ".env" ]; then
  echo ""
  echo "  .env file not found."
  echo "  Run: cp .env.example .env  then fill in your credentials."
  echo ""
  exit 1
fi

if ! docker info > /dev/null 2>&1; then
  echo ""
  echo "  Docker is not running. Please start Docker and try again."
  echo ""
  exit 1
fi

echo "Building image and starting container..."
docker compose up --build -d

echo ""
echo "  Application is starting up."
echo "  Open http://localhost:8000 in your browser."
echo "  (Allow ~15 seconds for first startup.)"
echo ""
echo "  To stop: bash scripts/stop-mac.sh"
