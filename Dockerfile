FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends build-essential cmake curl \
    && rm -rf /var/lib/apt/lists/*

COPY backend/ backend/
COPY --from=frontend-builder /build/frontend/dist frontend/dist/

RUN pip install --no-cache-dir -r backend/requirements.txt

RUN mkdir -p /app/models && \
    curl -#L -o /app/models/main.gguf \
        "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/Qwen3.5-2B-Q4_K_M.gguf" && \
    curl -#L -o /app/models/main-mmproj.gguf \
        "https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/resolve/main/mmproj-BF16.gguf"

EXPOSE 5000

CMD ["python3", "backend/server.py"]
