# === Stage 1: Build the Vite frontend ===
FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
# Copy the frontend source. ``.dockerignore`` keeps ``node_modules``
# out of the build context (we installed it via ``npm ci``) and also
# excludes the top-level ``plugins/`` (the user's runtime plugin
# staging dir). The resulting dist contains the loader only; the
# runtime entrypoint rebuilds with user plugins after a mount.
COPY frontend/ .
RUN npm run build

# === Stage 2: Python runtime + Node 22 for on-demand frontend rebuild ===
FROM python:3.12-slim
WORKDIR /app

# Install build deps (llama-cpp-python, sherpa-onnx need C++) plus
# Node.js 22 + curl for the runtime frontend rebuild done by the
# entrypoint when the user mounts frontend plugins.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Mount target for the co-located user plugin dir. .dockerignore
# strips the repo's ``plugins/`` from the build context, so this
# is always empty in the image; the docker-compose mount provides
# the user's plugins at runtime.
RUN mkdir -p /app/plugins

# Frontend source (so the entrypoint can rebuild with mounted user
# plugins) + node_modules from the builder (same Node 22, so the
# prebuilt deps are compatible).
COPY frontend/ frontend/
COPY --from=frontend-builder /build/frontend/node_modules frontend/node_modules/

# Backend (loader in ``backend/plugins/`` + the entrypoint/sync scripts
# + empty ``user_plugins/`` was removed; the registry now scans the
# unified ``plugins/`` dir).
COPY backend/ backend/
COPY --from=frontend-builder /build/frontend/dist frontend/dist/

# Install Python dependencies.
RUN pip install --no-cache-dir -r backend/requirements.txt

# Entrypoint: normalise user plugins (copy frontend halves into the
# Vite tree), optionally rebuild the bundle, then exec the backend.
RUN chmod +x backend/entrypoint.sh backend/sync_plugins.sh

# Download the GGUF model + multimodal projection from Hugging Face
RUN mkdir -p /app/models && \
    curl -#L -o /app/models/main.gguf \
        "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf" && \
    curl -#L -o /app/models/main-mmproj.gguf \
        "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-BF16.gguf"

# Download the Piper TTS model (en_US-amy-medium, single female voice).
RUN mkdir -p /app/models/tts/vits-piper-en_US-amy-medium && \
    curl -#L -o /tmp/piper-tts.tar.bz2 \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-amy-medium.tar.bz2" && \
    tar xf /tmp/piper-tts.tar.bz2 -C /app/models/tts/ && \
    rm /tmp/piper-tts.tar.bz2 && \
    ls -lh /app/models/tts/vits-piper-en_US-amy-medium/

# Download the Silero VAD model.
RUN mkdir -p /app/models/stt && \
    curl -#L -o /app/models/stt/silero_vad.onnx \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx"

# Download the Parakeet TDT 0.6B v3 int8 ASR model.
RUN curl -#L -o /tmp/parakeet-stt.tar.bz2 \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2" && \
    tar xf /tmp/parakeet-stt.tar.bz2 -C /app/models/stt/ && \
    rm /tmp/parakeet-stt.tar.bz2 && \
    ls -lh /app/models/stt/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/

EXPOSE 5000

# Entrypoint: syncs user plugins into the frontend tree, rebuilds
# if any frontend plugins are present, then execs the backend.
CMD ["backend/entrypoint.sh"]
