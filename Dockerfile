# 스톡 인사이트 — 단일 이미지 (프론트 빌드 + FastAPI 서빙)

# 1) 프론트엔드 빌드
FROM node:20-slim AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# 2) 백엔드 + 정적 서빙
FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt ./backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend/ ./backend/
COPY --from=frontend /app/frontend/dist ./frontend/dist
WORKDIR /app/backend
ENV PORT=8000
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT}
