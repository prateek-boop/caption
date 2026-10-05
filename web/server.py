import os
import uuid
import json
import shutil
import mimetypes
from datetime import datetime
from typing import Optional, List, Dict, Any

import torch
from fastapi import FastAPI, Depends, HTTPException, status, UploadFile, File, Form, Query, Request
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from .database import (
    init_db,
    get_db,
    User,
    UserSettings,
    TranscriptionJob,
    UPLOADS_DIR,
    EXPORTS_DIR,
)
from .auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    get_optional_user,
)
from .worker import start_worker, queue_job, active_jobs
from .exporters import export_srt, export_vtt, export_txt, export_tsv, export_json

# Initialize DB tables on startup
init_db()
start_worker()

app = FastAPI(title="Captioner Studio", version="1.0.0")

# Enable CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "static")
os.makedirs(STATIC_DIR, exist_ok=True)


# ------------------ Schemas ------------------
class RegisterRequest(BaseModel):
    username: str
    email: str
    password: str


class LoginRequest(BaseModel):
    username: str
    password: str


class UserSettingsUpdate(BaseModel):
    default_hf_token: Optional[str] = None
    default_device: Optional[str] = None
    default_compute_type: Optional[str] = None
    default_model: Optional[str] = None


class SegmentUpdatePayload(BaseModel):
    segments: List[Dict[str, Any]]


# ------------------ Auth Routes ------------------
@app.post("/api/auth/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    if len(req.username.strip()) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters.")
    if len(req.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")

    existing_user = db.query(User).filter(
        (User.username == req.username.strip()) | (User.email == req.email.strip().lower())
    ).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Username or email already exists.")

    new_user = User(
        username=req.username.strip(),
        email=req.email.strip().lower(),
        hashed_password=hash_password(req.password),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Create default settings
    default_device = "cuda" if torch.cuda.is_available() else "cpu"
    settings = UserSettings(
        user_id=new_user.id,
        default_device=default_device,
        default_compute_type="float16" if default_device == "cuda" else "int8",
        default_model="base",
    )
    db.add(settings)
    db.commit()

    token = create_access_token({"sub": new_user.username, "user_id": new_user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": new_user.id,
            "username": new_user.username,
            "email": new_user.email,
        }
    }


@app.post("/api/auth/login")
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username.strip()).first()
    if not user or not verify_password(req.password, user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid username or password.")

    token = create_access_token({"sub": user.username, "user_id": user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
        }
    }


@app.get("/api/auth/me")
def get_me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    settings = db.query(UserSettings).filter(UserSettings.user_id == current_user.id).first()
    return {
        "id": current_user.id,
        "username": current_user.username,
        "email": current_user.email,
        "settings": {
            "default_hf_token": settings.default_hf_token if settings else "",
            "default_device": settings.default_device if settings else ("cuda" if torch.cuda.is_available() else "cpu"),
            "default_compute_type": settings.default_compute_type if settings else "float16",
            "default_model": settings.default_model if settings else "base",
        } if settings else {}
    }


@app.put("/api/auth/settings")
def update_settings(
    req: UserSettingsUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    settings = db.query(UserSettings).filter(UserSettings.user_id == current_user.id).first()
    if not settings:
        settings = UserSettings(user_id=current_user.id)
        db.add(settings)

    if req.default_hf_token is not None:
        settings.default_hf_token = req.default_hf_token
    if req.default_device is not None:
        settings.default_device = req.default_device
    if req.default_compute_type is not None:
        settings.default_compute_type = req.default_compute_type
    if req.default_model is not None:
        settings.default_model = req.default_model

    db.commit()
    return {"message": "Settings updated successfully"}


# ------------------ System Information ------------------
@app.get("/api/system/info")
def system_info():
    cuda_available = torch.cuda.is_available()
    gpu_name = torch.cuda.get_device_name(0) if cuda_available else "Not detected / CPU only"
    cuda_version = torch.version.cuda if cuda_available else None

    return {
        "cuda_available": cuda_available,
        "gpu_name": gpu_name,
        "cuda_version": cuda_version,
        "available_models": [
            {"id": "tiny", "label": "Tiny (~39M) - Ultra Fast"},
            {"id": "base", "label": "Base (~74M) - Balanced Fast"},
            {"id": "small", "label": "Small (~244M) - Good Quality"},
            {"id": "medium", "label": "Medium (~769M) - High Quality"},
            {"id": "large-v2", "label": "Large-v2 (~1550M) - Best Accuracy"},
            {"id": "large-v3", "label": "Large-v3 (~1550M) - Latest Large Model"},
        ],
        "compute_types": ["float16", "int8", "float32"],
        "default_device": "cuda" if cuda_available else "cpu",
    }


# ------------------ Transcription Job Endpoints ------------------
@app.post("/api/transcribe/upload")
async def upload_and_transcribe(
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    model_size: str = Form("base"),
    device: Optional[str] = Form(None),
    compute_type: Optional[str] = Form(None),
    batch_size: int = Form(16),
    language: Optional[str] = Form("auto"),
    align: bool = Form(True),
    diarize: bool = Form(False),
    hf_token: Optional[str] = Form(None),
    min_speakers: Optional[int] = Form(None),
    max_speakers: Optional[int] = Form(None),
    interleaved_context: bool = Form(False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    job_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1].lower()
    if not ext:
        ext = ".wav"
    stored_filename = f"{job_id}{ext}"
    file_path = os.path.join(UPLOADS_DIR, stored_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    file_size = os.path.getsize(file_path)

    # Resolve defaults
    user_settings = db.query(UserSettings).filter(UserSettings.user_id == current_user.id).first()
    selected_device = device or (user_settings.default_device if user_settings else ("cuda" if torch.cuda.is_available() else "cpu"))
    selected_compute = compute_type or (user_settings.default_compute_type if user_settings else ("float16" if selected_device == "cuda" else "int8"))
    resolved_hf_token = hf_token or (user_settings.default_hf_token if user_settings else None)

    options = {
        "model_size": model_size,
        "device": selected_device,
        "compute_type": selected_compute,
        "batch_size": batch_size,
        "language": language if language != "auto" else None,
        "align": align,
        "diarize": diarize,
        "hf_token": resolved_hf_token,
        "min_speakers": min_speakers,
        "max_speakers": max_speakers,
        "interleaved_context": interleaved_context,
    }

    job = TranscriptionJob(
        id=job_id,
        user_id=current_user.id,
        title=title.strip() if title else file.filename,
        original_filename=file.filename,
        stored_filename=stored_filename,
        file_path=file_path,
        file_size=file_size,
        status="pending",
        current_step="queued",
        progress=0.0,
        options=options,
    )
    db.add(job)
    db.commit()

    # Queue background task
    queue_job(job_id)

    return {
        "job_id": job.id,
        "title": job.title,
        "status": job.status,
        "progress": job.progress,
        "message": "Audio uploaded and transcription job queued successfully.",
    }


@app.get("/api/jobs")
def list_jobs(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    jobs = db.query(TranscriptionJob).filter(
        TranscriptionJob.user_id == current_user.id
    ).order_by(TranscriptionJob.created_at.desc()).all()

    result = []
    for j in jobs:
        # Check if live update in active_jobs
        mem_info = active_jobs.get(j.id, {})
        status_val = mem_info.get("status", j.status)
        step_val = mem_info.get("current_step", j.current_step)
        progress_val = mem_info.get("progress", j.progress)

        result.append({
            "id": j.id,
            "title": j.title,
            "original_filename": j.original_filename,
            "file_size": j.file_size,
            "audio_duration": j.audio_duration,
            "status": status_val,
            "current_step": step_val,
            "progress": progress_val,
            "options": j.options,
            "created_at": j.created_at.isoformat() if j.created_at else None,
            "completed_at": j.completed_at.isoformat() if j.completed_at else None,
            "error_message": j.error_message,
        })
    return result


@app.get("/api/jobs/{job_id}")
def get_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    job = db.query(TranscriptionJob).filter(
        TranscriptionJob.id == job_id,
        TranscriptionJob.user_id == current_user.id
    ).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    mem_info = active_jobs.get(job.id, {})
    status_val = mem_info.get("status", job.status)
    step_val = mem_info.get("current_step", job.current_step)
    progress_val = mem_info.get("progress", job.progress)

    return {
        "id": job.id,
        "title": job.title,
        "original_filename": job.original_filename,
        "file_size": job.file_size,
        "audio_duration": job.audio_duration,
        "status": status_val,
        "current_step": step_val,
        "progress": progress_val,
        "options": job.options,
        "result_data": job.result_data,
        "created_at": job.created_at.isoformat() if job.created_at else None,
        "completed_at": job.completed_at.isoformat() if job.completed_at else None,
        "error_message": job.error_message,
    }


@app.put("/api/jobs/{job_id}/segments")
def update_job_segments(
    job_id: str,
    payload: SegmentUpdatePayload,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    job = db.query(TranscriptionJob).filter(
        TranscriptionJob.id == job_id,
        TranscriptionJob.user_id == current_user.id
    ).first()

    if not job or not job.result_data:
        raise HTTPException(status_code=404, detail="Job not found or no results")

    res = dict(job.result_data)
    res["segments"] = payload.segments
    job.result_data = res
    db.commit()
    return {"message": "Segments updated successfully", "segments_count": len(payload.segments)}


@app.delete("/api/jobs/{job_id}")
def delete_job(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    job = db.query(TranscriptionJob).filter(
        TranscriptionJob.id == job_id,
        TranscriptionJob.user_id == current_user.id
    ).first()

    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    # Remove audio file if exists
    if job.file_path and os.path.exists(job.file_path):
        try:
            os.remove(job.file_path)
        except Exception:
            pass

    active_jobs.pop(job_id, None)
    db.delete(job)
    db.commit()
    return {"message": "Job deleted successfully"}


# ------------------ Audio Streaming (Supports HTTP Range Header) ------------------
@app.get("/api/jobs/{job_id}/audio")
def stream_audio(
    job_id: str,
    request: Request,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db)
):
    # Support token via query parameter for <audio src="..."> tags in HTML
    user = None
    if token:
        from .auth import decode_access_token
        payload = decode_access_token(token)
        if payload and "sub" in payload:
            user = db.query(User).filter(User.username == payload["sub"]).first()

    job = db.query(TranscriptionJob).filter(TranscriptionJob.id == job_id).first()
    if not job or not os.path.exists(job.file_path):
        raise HTTPException(status_code=404, detail="Audio file not found")

    if user and job.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    file_size = os.path.getsize(job.file_path)
    mime_type, _ = mimetypes.guess_type(job.file_path)
    if not mime_type:
        mime_type = "audio/mpeg"

    range_header = request.headers.get("range")
    if range_header:
        byte_range = range_header.replace("bytes=", "").split("-")
        start = int(byte_range[0])
        end = int(byte_range[1]) if byte_range[1] else file_size - 1
        content_length = (end - start) + 1

        def range_generator(start_byte, end_byte, chunk_size=64 * 1024):
            with open(job.file_path, "rb") as f:
                f.seek(start_byte)
                remaining = (end_byte - start_byte) + 1
                while remaining > 0:
                    read_bytes = min(chunk_size, remaining)
                    data = f.read(read_bytes)
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(content_length),
            "Content-Type": mime_type,
        }
        return StreamingResponse(
            range_generator(start, end),
            status_code=206,
            headers=headers
        )

    return FileResponse(
        job.file_path,
        media_type=mime_type,
        filename=job.original_filename,
    )


# ------------------ Exporters ------------------
@app.get("/api/jobs/{job_id}/export/{export_format}")
def export_job_transcript(
    job_id: str,
    export_format: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    job = db.query(TranscriptionJob).filter(
        TranscriptionJob.id == job_id,
        TranscriptionJob.user_id == current_user.id
    ).first()

    if not job or not job.result_data:
        raise HTTPException(status_code=404, detail="Job result not found")

    fmt = export_format.lower()
    base_name = os.path.splitext(job.original_filename)[0]

    if fmt == "srt":
        content = export_srt(job.result_data)
        media_type = "text/plain"
        ext = "srt"
    elif fmt == "vtt":
        content = export_vtt(job.result_data)
        media_type = "text/vtt"
        ext = "vtt"
    elif fmt == "txt":
        content = export_txt(job.result_data)
        media_type = "text/plain"
        ext = "txt"
    elif fmt == "tsv":
        content = export_tsv(job.result_data)
        media_type = "text/tab-separated-values"
        ext = "tsv"
    elif fmt == "json":
        content = export_json(job.result_data)
        media_type = "application/json"
        ext = "json"
    else:
        raise HTTPException(status_code=400, detail=f"Unsupported format: {fmt}")

    headers = {
        "Content-Disposition": f'attachment; filename="{base_name}.{ext}"'
    }
    return StreamingResponse(
        iter([content.encode("utf-8")]),
        media_type=media_type,
        headers=headers,
    )


# Mount static frontend
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
