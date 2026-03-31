# ── Stage 1: Build Next.js static export ──────────────────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /build/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build
# Output: /build/frontend/out/

# ── Stage 2: Runtime (Python + Node.js for Tableau MCP subprocess) ────────────
FROM python:3.12-slim

# Install Node.js 20 and curl (curl used by healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends nodejs && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# Pre-install the Tableau MCP server globally so npx uses it without downloading
RUN npm install -g @tableau/mcp-server

# Install uv
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Install Python dependencies from lockfile (reproducible, no network needed)
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev

# Copy backend source
COPY backend/app/ ./app/

# Copy built frontend static files
COPY --from=frontend-build /build/frontend/out/ ./frontend/out/

EXPOSE 8000

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
