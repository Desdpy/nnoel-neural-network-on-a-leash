#!/usr/bin/env bash
# Start Nnoel directly (no Docker) — builds the frontend, activates venv, downloads model if missing
set -e

echo "==> Building frontend..."
cd frontend && npm run build && cd ..

echo ""
echo "==> Starting..."

# Activate the Python virtual environment if it exists
VENV_DIR="backend/.venv"
if [ -d "$VENV_DIR" ]; then
    source "$VENV_DIR/bin/activate"
fi

MODEL_DIR="models"
MAIN_MODEL="$MODEL_DIR/main.gguf"
MMPROJ_MODEL="$MODEL_DIR/main-mmproj.gguf"

# Download a model file from Hugging Face only if it's not already present
download_if_missing() {
    url="$1"
    path="$2"
    if [ -z "$url" ] || [ -z "$path" ]; then
        return
    fi
    if [ ! -f "$path" ]; then
        echo "Downloading $path ..."
        mkdir -p "$(dirname "$path")"
        curl -#L -o "$path" "$url"
    fi
}

download_if_missing "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf" "$MAIN_MODEL"
download_if_missing "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-BF16.gguf" "$MMPROJ_MODEL"

# Run the FastAPI server
python3 backend/server.py
