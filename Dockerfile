# === Stage 1: Build the Vite frontend ===
# Must be glibc (Debian), NOT alpine: this stage's ``node_modules`` is
# copied verbatim into the Debian-based runtime stage below, and the two
# ship different native binaries for the same packages (rollup,
# esbuild). An alpine builder installs ``@rollup/rollup-linux-x64-musl``
# and the runtime would then fail the entrypoint's rebuild with
# ``Cannot find module '@rollup/rollup-linux-x64-gnu'``. Only this
# build stage is glibc — it is never part of the final image.
FROM node:22-slim AS frontend-builder
WORKDIR /build/frontend
# Copy package files + the postinstall script. The package.json
# ``postinstall`` hook (``scripts/sync-root-symlink.cjs``) creates
# a root-level ``node_modules`` symlink for editor ergonomics on
# plugin source under ``plugins/``; the build itself doesn't need
# the symlink, but we run the script so the install flow stays
# identical to a developer machine. The script is safe to run in
# the container — it warns and continues if the symlink can't be
# created, so the build never depends on the symlink existing.
COPY frontend/package*.json ./
COPY frontend/scripts/ ./scripts/
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

# Install build deps (sherpa-onnx need C++) plus
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
# plugins) + node_modules from the builder. The entrypoint's rebuild
# only works because this glibc ``node_modules`` is ABI-compatible
# with this Debian runtime *and* because it creates a repo-root
# ``node_modules`` symlink (see ``backend/entrypoint.sh``) so plugin
# sources outside the Vite project can resolve bare imports.
COPY frontend/ frontend/
COPY --from=frontend-builder /build/frontend/node_modules frontend/node_modules/

# Backend (loader in ``backend/plugins/`` + the entrypoint/sync scripts
# + empty ``user_plugins/`` was removed; the registry now scans the
# unified ``plugins/`` dir).
COPY backend/ backend/
# Default config baked into the image at the project root. In the
# dev compose setup, ``./config.toml`` is bind-mounted on top of
# this so user edits in the host tree take effect without a rebuild.
COPY config.toml config.toml
COPY --from=frontend-builder /build/frontend/dist frontend/dist/

# Install Python dependencies.
RUN pip install --no-cache-dir -r backend/requirements.txt

# Entrypoint: optionally rebuild the bundle to pick up mounted
# user plugins, then exec the backend.
RUN chmod +x backend/entrypoint.sh

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

# Download the Whisper-tiny spoken-language-identification model.
# Used to auto-detect the language of each transcribed utterance
# (covers ~30 languages, ~98 MB extracted, RTF ~0.04 on a single
# x86 CPU thread).
RUN mkdir -p /app/models/lid && \
    curl -#L -o /tmp/lid-whisper-tiny.tar.bz2 \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-whisper-tiny.tar.bz2" && \
    tar xf /tmp/lid-whisper-tiny.tar.bz2 -C /app/models/lid/ && \
    rm /tmp/lid-whisper-tiny.tar.bz2 && \
    ls -lh /app/models/lid/sherpa-onnx-whisper-tiny/

EXPOSE 5000

# Entrypoint: syncs user plugins into the frontend tree, rebuilds
# if any frontend plugins are present, then execs the backend.
CMD ["backend/entrypoint.sh"]
