#!/usr/bin/env bash
set -e

# Captioner Studio Startup Script
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Ensure venv python is used
if [ -f ".venv/bin/python" ]; then
    PYTHON_EXEC=".venv/bin/python"
elif command -v uv &> /dev/null; then
    PYTHON_EXEC="uv run python"
else
    PYTHON_EXEC="python3"
fi

PORT="${PORT:-8080}"
HOST="${HOST:-0.0.0.0}"

echo "=========================================================="
echo "  🎙️ Launching Captioner Studio Web Application"
echo "=========================================================="
echo "  Server: http://localhost:${PORT}"
echo "  Swagger API Docs: http://localhost:${PORT}/docs"
echo "=========================================================="

exec $PYTHON_EXEC run_studio.py
