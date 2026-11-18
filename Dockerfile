# syntax=docker/dockerfile:1
FROM python:3.10-slim

# Labels
LABEL maintainer="Captioner Studio Team"
LABEL description="Accelerated ASR, Forced Phoneme Alignment, Diarization, and 3D Media Clipper Studio"

# Environment settings
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive \
    HOST=0.0.0.0 \
    PORT=8080 \
    PYTHONPATH=/app

WORKDIR /app

# Install system dependencies (FFmpeg with codecs, libsndfile, git, curl)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    git \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Install uv for ultra-fast dependency installation
COPY --from=ghcr.io/astral-sh/uv:latest /uv /bin/uv

# Copy dependency configuration first to leverage Docker layer caching
COPY pyproject.toml README.md ./

# Install python dependencies with uv into system python
RUN uv pip install --system --no-cache ".[web]"

# Copy source packages, web application, and launcher
COPY captioner/ ./captioner/
COPY web/ ./web/
COPY run_studio.py ./

# Create persistent storage directories
RUN mkdir -p /app/web/data/uploads /app/web/data/clips

EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:8080/api/system/info || exit 1

# Start the complete studio server (FastAPI + Background Pipeline Worker)
ENTRYPOINT ["python", "run_studio.py"]
