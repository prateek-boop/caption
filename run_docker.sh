#!/usr/bin/env bash
set -e

# ==============================================================================
# Captioner Studio - Single-Command Docker Launcher
# ==============================================================================

echo "===================================================================="
echo "  🚀 Starting Captioner Studio & 3D Media Clipper in Docker"
echo "===================================================================="

# Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed or not in PATH."
    echo "   Please install Docker from https://docs.docker.com/get-docker/"
    exit 1
fi

# Ensure data directories exist
mkdir -p web/data/uploads web/data/clips

# Detect NVIDIA GPU
if command -v nvidia-smi &> /dev/null; then
    echo "⚡ NVIDIA GPU detected ($(nvidia-smi --query-gpu=name --format=csv,noheader | head -n 1))."
    echo "   To enable GPU in Docker, ensure nvidia-container-toolkit is installed."
fi

echo "📦 Building and starting container..."
docker compose up --build -d

echo ""
echo "===================================================================="
echo "  ✅ Captioner Studio is running!"
echo "  🌐 Web Interface: http://localhost:8080"
echo "  📚 API Docs:      http://localhost:8080/docs"
echo "  📋 View logs:     docker compose logs -f"
echo "  🛑 Stop server:   docker compose down"
echo "===================================================================="
