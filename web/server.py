import os
import uuid
import json
import shutil
import mimetypes
from datetime import datetime
from typing import Optional, List, Dict, Any

try:
    import torch
    CUDA_AVAILABLE = torch.cuda.is_available()
    CUDA_DEVICE_NAME = torch.cuda.get_device_name(0) if CUDA_AVAILABLE else "Not detected / CPU only"
    CUDA_VERSION = torch.version.cuda if CUDA_AVAILABLE else None
except ImportError:
    torch = None
    CUDA_AVAILABLE = False
    CUDA_DEVICE_NAME = "PyTorch not installed / CPU only"
    CUDA_VERSION = None

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
    MediaClip,
    UPLOADS_DIR,
    EXPORTS_DIR,
    CLIPS_DIR,
)
from .auth import (
    hash_password,
    verify_password,
    create_access_token,
    get_current_user,
    get_optional_user,
    decode_access_token,
)
from .worker import start_worker, queue_job, active_jobs
from .exporters import export_srt, export_vtt, export_txt, export_tsv, export_json
from captioner.clipper import (
    clip_media,
    probe_media,
    slice_transcript,
    export_srt_from_segments,
    ClipperError,
    InvalidMediaFileError,
)

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


@app.middleware("http")
async def add_no_cache_header(request, call_next):
    response = await call_next(request)
    if request.url.path.endswith((".html", ".js", ".css")) or request.url.path == "/":
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
    return response

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


class ResetPasswordRequest(BaseModel):
    email: str
    new_password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UserSettingsUpdate(BaseModel):
    default_hf_token: Optional[str] = None
    default_device: Optional[str] = None
    default_compute_type: Optional[str] = None
    default_model: Optional[str] = None


class SegmentUpdatePayload(BaseModel):
    segments: List[Dict[str, Any]]


class CreateClipRequest(BaseModel):
    start_time: float
    end_time: Optional[float] = None
    title: Optional[str] = None
    burn_subtitles: bool = False
    mode: str = "exact"  # 'exact' or 'fast'
    target_format: Optional[str] = None  # None for auto/original, or 'mp4', 'mp3', 'wav', 'webm'
    video_crf: int = 18


# ------------------ Auth Routes ------------------
@app.post("/api/auth/register")
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    from sqlalchemy import func

    username_clean = req.username.strip()
    email_clean = req.email.strip().lower()
    password_clean = req.password

    if len(username_clean) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters.")
    if len(password_clean) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")
    if "@" not in email_clean or "." not in email_clean:
        raise HTTPException(status_code=400, detail="Please enter a valid email address.")

    existing_username = db.query(User).filter(
        func.lower(User.username) == username_clean.lower()
    ).first()
    if existing_username:
        raise HTTPException(status_code=400, detail="This username is already taken. Please choose another username.")

    existing_email = db.query(User).filter(
        func.lower(User.email) == email_clean.lower()
    ).first()
    if existing_email:
        raise HTTPException(status_code=400, detail="This email is already registered. Please sign in instead.")

    new_user = User(
        username=username_clean,
        email=email_clean,
        hashed_password=hash_password(password_clean),
    )
    db.add(new_user)
    db.commit()
    db.refresh(new_user)

    # Create default settings
    default_device = "cuda" if CUDA_AVAILABLE else "cpu"
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
    from sqlalchemy import func

    identifier = req.username.strip()
    password_clean = req.password

    if not identifier:
        raise HTTPException(status_code=400, detail="Please enter your username or email.")
    if not password_clean:
        raise HTTPException(status_code=400, detail="Please enter your password.")

    # Match by either username (case-insensitive) OR email (case-insensitive)
    user = db.query(User).filter(
        (func.lower(User.username) == identifier.lower()) |
        (func.lower(User.email) == identifier.lower())
    ).first()

    if not user or not verify_password(password_clean, user.hashed_password):
        raise HTTPException(status_code=400, detail="Invalid username/email or password.")

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


@app.post("/api/auth/reset-password")
def reset_password(req: ResetPasswordRequest, db: Session = Depends(get_db)):
    from sqlalchemy import func

    email_clean = req.email.strip().lower()
    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters.")

    user = db.query(User).filter(
        func.lower(User.email) == email_clean
    ).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found with this email address.")

    user.hashed_password = hash_password(req.new_password)
    db.commit()

    token = create_access_token({"sub": user.username, "user_id": user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": user.id,
            "username": user.username,
            "email": user.email,
        },
        "message": "Password updated successfully!"
    }


@app.post("/api/auth/change-password")
def change_password(
    req: ChangePasswordRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)
):
    if not verify_password(req.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect.")
    if len(req.new_password) < 4:
        raise HTTPException(status_code=400, detail="New password must be at least 4 characters.")

    current_user.hashed_password = hash_password(req.new_password)
    db.commit()
    return {"message": "Password changed successfully!"}


@app.post("/api/auth/guest")
def guest_login(db: Session = Depends(get_db)):
    guest_user = db.query(User).filter(User.username == "guest").first()
    if not guest_user:
        guest_user = User(
            username="guest",
            email="guest@local.studio",
            hashed_password=hash_password("guest_local_pwd_1234"),
        )
        db.add(guest_user)
        db.commit()
        db.refresh(guest_user)

        default_device = "cuda" if CUDA_AVAILABLE else "cpu"
        settings = UserSettings(
            user_id=guest_user.id,
            default_device=default_device,
            default_compute_type="float16" if default_device == "cuda" else "int8",
            default_model="base",
        )
        db.add(settings)
        db.commit()

    token = create_access_token({"sub": guest_user.username, "user_id": guest_user.id})
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {
            "id": guest_user.id,
            "username": guest_user.username,
            "email": guest_user.email,
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
            "default_device": settings.default_device if settings else ("cuda" if CUDA_AVAILABLE else "cpu"),
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
    cuda_available = CUDA_AVAILABLE
    gpu_name = CUDA_DEVICE_NAME
    cuda_version = CUDA_VERSION

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
    selected_device = device or (user_settings.default_device if user_settings else ("cuda" if CUDA_AVAILABLE else "cpu"))
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


# ------------------ Media Clipping Endpoints ------------------
@app.post("/api/jobs/{job_id}/clip")
def create_job_clip(
    job_id: str,
    req: CreateClipRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Clip media from an existing transcription job with exact frame accuracy,
    optional subtitle burning, and transcript slicing.
    """
    job = db.query(TranscriptionJob).filter(
        TranscriptionJob.id == job_id,
        TranscriptionJob.user_id == current_user.id
    ).first()

    if not job or not os.path.exists(job.file_path):
        raise HTTPException(status_code=404, detail="Job or original media file not found")

    clip_id = str(uuid.uuid4())
    input_ext = os.path.splitext(job.stored_filename)[1].lstrip(".")
    output_ext = req.target_format.lower().lstrip(".") if req.target_format else input_ext
    if not output_ext:
        output_ext = "mp4"

    clip_filename = f"{clip_id}.{output_ext}"
    clip_path = os.path.join(CLIPS_DIR, clip_filename)

    try:
        final_path, meta = clip_media(
            input_path=job.file_path,
            output_path=clip_path,
            start_time=req.start_time,
            end_time=req.end_time,
            mode=req.mode,
            burn_subtitles=req.burn_subtitles,
            subtitles_data=job.result_data,
            target_format=req.target_format,
            video_crf=req.video_crf,
        )
    except (ValueError, ClipperError, InvalidMediaFileError) as err:
        raise HTTPException(status_code=400, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=500, detail=f"Clipping execution error: {str(err)}")

    start_str = f"{meta['start_time']:.1f}s"
    end_str = f"{meta['end_time']:.1f}s"
    clip_title = req.title.strip() if req.title else f"{job.title} [{start_str} - {end_str}]"

    new_clip = MediaClip(
        id=clip_id,
        job_id=job.id,
        user_id=current_user.id,
        title=clip_title,
        filename=os.path.basename(final_path),
        file_path=final_path,
        file_size=meta["file_size"],
        start_time=meta["start_time"],
        end_time=meta["end_time"],
        duration=meta["duration"],
        format=meta["format"],
        mode=meta["mode"],
        burned_subtitles=meta["burned_subtitles"],
        sliced_transcript=meta.get("sliced_transcript"),
    )
    db.add(new_clip)
    db.commit()
    db.refresh(new_clip)

    return {
        "clip_id": new_clip.id,
        "title": new_clip.title,
        "filename": new_clip.filename,
        "duration": new_clip.duration,
        "start_time": new_clip.start_time,
        "end_time": new_clip.end_time,
        "file_size": new_clip.file_size,
        "mode": new_clip.mode,
        "burned_subtitles": new_clip.burned_subtitles,
        "stream_url": f"/api/clips/{new_clip.id}/stream",
        "download_url": f"/api/clips/{new_clip.id}/download",
        "sliced_transcript": new_clip.sliced_transcript,
    }


@app.get("/api/jobs/{job_id}/clips")
def list_job_clips(
    job_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all clips created for a specific job."""
    clips = db.query(MediaClip).filter(
        MediaClip.job_id == job_id,
        MediaClip.user_id == current_user.id
    ).order_by(MediaClip.created_at.desc()).all()

    return [
        {
            "id": c.id,
            "job_id": c.job_id,
            "title": c.title,
            "filename": c.filename,
            "duration": c.duration,
            "start_time": c.start_time,
            "end_time": c.end_time,
            "file_size": c.file_size,
            "mode": c.mode,
            "burned_subtitles": c.burned_subtitles,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "stream_url": f"/api/clips/{c.id}/stream",
            "download_url": f"/api/clips/{c.id}/download",
            "has_sliced_transcript": bool(c.sliced_transcript),
        }
        for c in clips
    ]


@app.get("/api/clips")
def list_all_clips(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List all clips created by the current user across all jobs and direct uploads."""
    clips = db.query(MediaClip).filter(
        MediaClip.user_id == current_user.id
    ).order_by(MediaClip.created_at.desc()).all()

    return [
        {
            "id": c.id,
            "job_id": c.job_id,
            "title": c.title,
            "filename": c.filename,
            "duration": c.duration,
            "start_time": c.start_time,
            "end_time": c.end_time,
            "file_size": c.file_size,
            "mode": c.mode,
            "burned_subtitles": c.burned_subtitles,
            "created_at": c.created_at.isoformat() if c.created_at else None,
            "stream_url": f"/api/clips/{c.id}/stream",
            "download_url": f"/api/clips/{c.id}/download",
            "has_sliced_transcript": bool(c.sliced_transcript),
        }
        for c in clips
    ]


@app.get("/api/clips/{clip_id}/stream")
def stream_clip(
    clip_id: str,
    request: Request,
    token: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    """
    Stream clipped media with HTTP Range support for seamless seeking and playback.
    """
    user = None
    if token:
        payload = decode_access_token(token)
        if payload and "sub" in payload:
            user = db.query(User).filter(User.username == payload["sub"]).first()

    clip = db.query(MediaClip).filter(MediaClip.id == clip_id).first()
    if not clip or not os.path.exists(clip.file_path):
        raise HTTPException(status_code=404, detail="Clip not found")

    if user and clip.user_id != user.id:
        raise HTTPException(status_code=403, detail="Forbidden")

    file_size = os.path.getsize(clip.file_path)
    mime_type, _ = mimetypes.guess_type(clip.file_path)
    if not mime_type:
        mime_type = "video/mp4" if clip.file_path.endswith((".mp4", ".mkv", ".webm")) else "audio/mpeg"

    range_header = request.headers.get("range")
    if range_header:
        byte_range = range_header.replace("bytes=", "").split("-")
        start = int(byte_range[0])
        end = int(byte_range[1]) if byte_range[1] else file_size - 1
        content_length = (end - start) + 1

        def range_generator(start_byte, end_byte, chunk_size=64 * 1024):
            with open(clip.file_path, "rb") as f:
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
        clip.file_path,
        media_type=mime_type,
        filename=clip.filename,
    )


@app.get("/api/clips/{clip_id}/download")
def download_clip(
    clip_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download the media clip file."""
    clip = db.query(MediaClip).filter(
        MediaClip.id == clip_id,
        MediaClip.user_id == current_user.id
    ).first()

    if not clip or not os.path.exists(clip.file_path):
        raise HTTPException(status_code=404, detail="Clip not found")

    mime_type, _ = mimetypes.guess_type(clip.file_path)
    if not mime_type:
        mime_type = "application/octet-stream"

    return FileResponse(
        clip.file_path,
        media_type=mime_type,
        filename=f"{clip.title}{os.path.splitext(clip.filename)[1]}",
        headers={"Content-Disposition": f'attachment; filename="{clip.filename}"'},
    )


@app.get("/api/clips/{clip_id}/subtitles/{export_format}")
def export_clip_subtitles(
    clip_id: str,
    export_format: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download sliced subtitles matching the clipped media."""
    clip = db.query(MediaClip).filter(
        MediaClip.id == clip_id,
        MediaClip.user_id == current_user.id
    ).first()

    if not clip or not clip.sliced_transcript:
        raise HTTPException(status_code=404, detail="Clip or sliced transcript not found")

    fmt = export_format.lower()
    base_name = os.path.splitext(clip.filename)[0]

    if fmt == "srt":
        content = export_srt(clip.sliced_transcript)
        media_type = "text/plain"
        ext = "srt"
    elif fmt == "vtt":
        content = export_vtt(clip.sliced_transcript)
        media_type = "text/vtt"
        ext = "vtt"
    elif fmt == "json":
        content = export_json(clip.sliced_transcript)
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


@app.delete("/api/clips/{clip_id}")
def delete_clip(
    clip_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a media clip."""
    clip = db.query(MediaClip).filter(
        MediaClip.id == clip_id,
        MediaClip.user_id == current_user.id
    ).first()

    if not clip:
        raise HTTPException(status_code=404, detail="Clip not found")

    if clip.file_path and os.path.exists(clip.file_path):
        try:
            os.remove(clip.file_path)
        except Exception:
            pass

    db.delete(clip)
    db.commit()
    return {"message": "Clip deleted successfully"}


@app.post("/api/media/clip")
async def standalone_clip_media(
    file: UploadFile = File(...),
    start_time: float = Form(0.0),
    end_time: Optional[float] = Form(None),
    title: Optional[str] = Form(None),
    mode: str = Form("exact"),
    burn_subtitles: bool = Form(False),
    target_format: Optional[str] = Form(None),
    video_crf: int = Form(18),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Direct standalone clipping endpoint for any media file without requiring a prior transcription job.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No media file provided")

    clip_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1].lower() or ".mp4"
    uploaded_path = os.path.join(UPLOADS_DIR, f"temp_{clip_id}{ext}")

    with open(uploaded_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    out_ext = target_format.lower().lstrip(".") if target_format else ext.lstrip(".")
    clip_filename = f"{clip_id}.{out_ext}"
    clip_path = os.path.join(CLIPS_DIR, clip_filename)

    try:
        final_path, meta = clip_media(
            input_path=uploaded_path,
            output_path=clip_path,
            start_time=start_time,
            end_time=end_time,
            mode=mode,
            burn_subtitles=burn_subtitles,
            target_format=target_format,
            video_crf=video_crf,
        )
    except Exception as err:
        if os.path.exists(uploaded_path):
            os.remove(uploaded_path)
        raise HTTPException(status_code=400, detail=str(err))

    # Clean up uploaded temp file
    if os.path.exists(uploaded_path):
        try:
            os.remove(uploaded_path)
        except Exception:
            pass

    clip_title = title.strip() if (title and title.strip()) else f"Clip: {file.filename} [{meta['start_time']}s - {meta['end_time']}s]"
    new_clip = MediaClip(
        id=clip_id,
        user_id=current_user.id,
        title=clip_title,
        filename=os.path.basename(final_path),
        file_path=final_path,
        file_size=meta["file_size"],
        start_time=meta["start_time"],
        end_time=meta["end_time"],
        duration=meta["duration"],
        format=meta["format"],
        mode=meta["mode"],
        burned_subtitles=meta["burned_subtitles"],
    )
    db.add(new_clip)
    db.commit()
    db.refresh(new_clip)

    return {
        "clip_id": new_clip.id,
        "title": new_clip.title,
        "filename": new_clip.filename,
        "duration": new_clip.duration,
        "start_time": new_clip.start_time,
        "end_time": new_clip.end_time,
        "file_size": new_clip.file_size,
        "mode": new_clip.mode,
        "stream_url": f"/api/clips/{new_clip.id}/stream",
        "download_url": f"/api/clips/{new_clip.id}/download",
    }


# Mount static frontend
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
