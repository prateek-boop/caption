#!/usr/bin/env python3
"""
Captioner Studio Launcher
Starts the FastAPI server with SQLite database, background pipeline worker,
full JWT authentication, and interactive web UI.
"""
import sys
import os
import uvicorn

# Ensure repository root is in python path
REPO_ROOT = os.path.dirname(os.path.abspath(__file__))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

def main():
    host = os.getenv("HOST", "0.0.0.0")
    port = int(os.getenv("PORT", 8080))
    print(f"\n===========================================================")
    print(f"  🎙️ Captioner Studio - Accelerated ASR & Diarization")
    print(f"===========================================================")
    print(f"  Web UI running at: http://localhost:{port}")
    print(f"  Interactive Docs: http://localhost:{port}/docs")
    print(f"===========================================================\n")
    uvicorn.run("web.server:app", host=host, port=port, reload=False)

if __name__ == "__main__":
    main()
