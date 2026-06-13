#!/usr/bin/env bash
set -e

echo "==> Building frontend..."
cd frontend && npm run build && cd ..

echo ""
echo "==> Starting..."

VENV_DIR="backend/.venv"
if [ -d "$VENV_DIR" ]; then
    source "$VENV_DIR/bin/activate"
fi

MODEL_DIR="models"
MAIN_MODEL="$MODEL_DIR/main.gguf"
MMPROJ_MODEL="$MODEL_DIR/main-mmproj.gguf"

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

download_if_missing "https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/Qwen3.5-0.8B-Q4_K_M.gguf" "$MAIN_MODEL"
download_if_missing "https://huggingface.co/unsloth/Qwen3.5-0.8B-GGUF/resolve/main/mmproj-BF16.gguf" "$MMPROJ_MODEL"

python3 backend/server.py
