#!/usr/bin/env bash
# Start Nnoel directly (no Docker) — builds the frontend, activates venv, downloads models if missing
set -e

echo "==> Synchronising user plugins (copying frontend halves into the Vite tree)..."
# Plugins live co-located at ``plugins/<id>/{backend,frontend}/``. The
# backend imports the backend halves directly via a synthetic package,
# but the frontend halves must be copied into the Vite project so
# module resolution works. ``sync_plugins.sh`` also prunes stale
# destination folders for plugins that were removed.
PLUGINS_DIR="$PWD/plugins" \
    FRONTEND_USER_DIR="$PWD/frontend/src/plugins/user" \
    bash backend/sync_plugins.sh

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

# Download a single model file only if it's not already present
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

# Download a tarball and extract it into a target directory only if
# the directory is missing.  ``marker`` is a file inside the tarball
# whose presence is used to detect an existing install (the tarball
# extracts to a subdirectory named after the archive, so we check for
# one of its expected files instead of the directory itself).
download_and_extract_if_missing() {
    url="$1"
    target_dir="$2"
    marker="$3"
    if [ -z "$url" ] || [ -z "$target_dir" ] || [ -z "$marker" ]; then
        return
    fi
    if [ -f "$marker" ]; then
        return
    fi
    echo "Downloading and extracting $target_dir ..."
    mkdir -p "$target_dir"
    tmp_archive="$(mktemp /tmp/nnoel-model-XXXXXX.tar.bz2)"
    # ``-f`` fails the script on a non-2xx response so we never
    # extract a truncated / HTML error page.
    if ! curl -#fL -o "$tmp_archive" "$url"; then
        echo "Download failed: $url" >&2
        rm -f "$tmp_archive"
        return 1
    fi
    tar xf "$tmp_archive" -C "$target_dir"
    rm -f "$tmp_archive"
}

# --- LLM (GGUF) ---
download_if_missing "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf" "$MAIN_MODEL"
download_if_missing "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-BF16.gguf" "$MMPROJ_MODEL"

# --- TTS (Piper VITS amy-medium) ---
TTS_MODEL_DIR="$MODEL_DIR/tts/vits-piper-en_US-amy-medium"
download_and_extract_if_missing \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-amy-medium.tar.bz2" \
    "$MODEL_DIR/tts" \
    "$TTS_MODEL_DIR/en_US-amy-medium.onnx"

# --- STT (Silero VAD + Parakeet TDT 0.6B v3 int8) ---
STT_MODEL_DIR="$MODEL_DIR/stt/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8"
download_if_missing \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx" \
    "$MODEL_DIR/stt/silero_vad.onnx"
download_and_extract_if_missing \
    "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2" \
    "$MODEL_DIR/stt" \
    "$STT_MODEL_DIR/encoder.int8.onnx"

# Run the FastAPI server
python3 backend/server.py
