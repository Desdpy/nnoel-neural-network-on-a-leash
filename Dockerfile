# === Stage 1: Build the Vite frontend ===
FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# === Stage 2: Python runtime with backend + prebuilt frontend ===
FROM python:3.12-slim
WORKDIR /app

# Install build deps for llama-cpp-python and sherpa-onnx (both have C++ extensions).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential cmake curl \
    && rm -rf /var/lib/apt/lists/*

# Copy source code
COPY backend/ backend/
COPY --from=frontend-builder /build/frontend/dist frontend/dist/

# Install Python dependencies
RUN pip install --no-cache-dir -r backend/requirements.txt

# Download the GGUF model + multimodal projection from Hugging Face
RUN mkdir -p /app/models && \
    curl -#L -o /app/models/main.gguf \
        "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf" && \
    curl -#L -o /app/models/main-mmproj.gguf \
        "https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/mmproj-BF16.gguf"

# Download the Piper TTS model (en_US-amy-medium, single female voice).
# The model directory ships espeak-ng-data and tokens alongside the ONNX
# weights — no separate download is needed.
RUN mkdir -p /app/models/tts/vits-piper-en_US-amy-medium && \
    curl -#L -o /tmp/piper-tts.tar.bz2 \
        "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-amy-medium.tar.bz2" && \
    tar xf /tmp/piper-tts.tar.bz2 -C /app/models/tts/ && \
    rm /tmp/piper-tts.tar.bz2 && \
    ls -lh /app/models/tts/vits-piper-en_US-amy-medium/

EXPOSE 5000

CMD ["python3", "backend/server.py"]