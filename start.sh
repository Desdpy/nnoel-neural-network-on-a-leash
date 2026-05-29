#!/usr/bin/env bash
set -e

echo "==> Building frontend..."
cd frontend && npm run build && cd ..

echo ""
echo "==> Starting backend..."

VENV_DIR="backend/.venv"
if [ -d "$VENV_DIR" ]; then
    source "$VENV_DIR/bin/activate"
fi

cd backend && python server.py
