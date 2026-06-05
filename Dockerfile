FROM node:22-alpine AS frontend-builder
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

FROM python:3.12-slim
WORKDIR /app

COPY backend/ backend/
COPY --from=frontend-builder /build/frontend/dist frontend/dist/

RUN pip install --no-cache-dir -r backend/requirements.txt

EXPOSE 5000

CMD ["python", "backend/server.py"]
