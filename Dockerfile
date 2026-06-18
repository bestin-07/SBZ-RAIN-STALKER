FROM node:20-alpine AS frontend
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
# VITE_* vars are baked in at build time. Railway passes service variables as
# build args, but they must be declared as ARG here to reach `npm run build`.
ARG VITE_DONATE_URL=""
ARG VITE_BACKEND_URL=""
ENV VITE_DONATE_URL=$VITE_DONATE_URL
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL
RUN npm run build

FROM python:3.11-slim
# Unbuffered stdout so print() diagnostics ([vapid], [push], [cycle]) show in
# Railway logs immediately instead of being block-buffered and lost.
ENV PYTHONUNBUFFERED=1
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --upgrade pip setuptools wheel && pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=frontend /app/frontend/dist ./static
RUN chown -R appuser:appgroup /app
USER appuser
EXPOSE 8080
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
