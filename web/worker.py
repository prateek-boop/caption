import os
import gc
import sys
import time
import queue
import logging
import threading
import traceback
from datetime import datetime
from typing import Dict, Any, Optional

import torch
from sqlalchemy.orm import Session
from .database import SessionLocal, TranscriptionJob

logger = logging.getLogger("captioner.studio.worker")
logger.setLevel(logging.INFO)

# Global thread-safe job queue
job_queue = queue.Queue()
active_jobs: Dict[str, Dict[str, Any]] = {}


def update_job_status(
    job_id: str,
    status: Optional[str] = None,
    current_step: Optional[str] = None,
    progress: Optional[float] = None,
    result_data: Optional[Dict[str, Any]] = None,
    error_message: Optional[str] = None,
    audio_duration: Optional[float] = None,
):
    """Safely update job status in the database and in-memory cache."""
    db: Session = SessionLocal()
    try:
        job = db.query(TranscriptionJob).filter(TranscriptionJob.id == job_id).first()
        if not job:
            return

        if status is not None:
            job.status = status
            if status == "completed":
                job.completed_at = datetime.utcnow()
                job.progress = 100.0

        if current_step is not None:
            job.current_step = current_step

        if progress is not None:
            job.progress = round(float(progress), 1)

        if audio_duration is not None:
            job.audio_duration = audio_duration

        if result_data is not None:
            job.result_data = result_data

        if error_message is not None:
            job.error_message = error_message

        job.updated_at = datetime.utcnow()
        db.commit()

        # Update in-memory active tracking
        if job_id in active_jobs:
            active_jobs[job_id]["status"] = job.status
            active_jobs[job_id]["current_step"] = job.current_step
            active_jobs[job_id]["progress"] = job.progress
            if error_message:
                active_jobs[job_id]["error"] = error_message

    except Exception as e:
        logger.error(f"Failed to update job {job_id}: {e}")
        db.rollback()
    finally:
        db.close()


def process_transcription_job(job_id: str):
    """Execute the full Captioner pipeline for a given job."""
    db: Session = SessionLocal()
    job = db.query(TranscriptionJob).filter(TranscriptionJob.id == job_id).first()
    if not job:
        db.close()
        return

    file_path = job.file_path
    options = job.options or {}
    db.close()

    model_name = options.get("model_size", "base")
    device = options.get("device", "cuda" if torch.cuda.is_available() else "cpu")
    compute_type = options.get("compute_type", "float16" if device == "cuda" else "int8")
    batch_size = int(options.get("batch_size", 16 if device == "cuda" else 4))
    language = options.get("language")
    if language == "auto" or not language:
        language = None

    do_align = options.get("align", True)
    do_diarize = options.get("diarize", False)
    hf_token = options.get("hf_token") or os.getenv("HF_TOKEN")
    min_speakers = options.get("min_speakers")
    max_speakers = options.get("max_speakers")
    if min_speakers:
        min_speakers = int(min_speakers)
    if max_speakers:
        max_speakers = int(max_speakers)
    interleaved_context = options.get("interleaved_context", False)

    logger.info(f"Starting job {job_id} on {device} with model {model_name}...")
    update_job_status(job_id, status="running", current_step="loading_audio", progress=5.0)

    try:
        import captioner

        # 1. Load Audio
        logger.info(f"Loading audio from {file_path}")
        audio = captioner.load_audio(file_path)
        # Calculate duration in seconds (sample rate 16000)
        duration = len(audio) / 16000.0
        update_job_status(job_id, current_step="audio_loaded", progress=10.0, audio_duration=duration)

        # 2. VAD & ASR
        update_job_status(job_id, current_step="transcribing", progress=15.0)
        logger.info(f"Loading Whisper model {model_name} ({compute_type}) on {device}")

        asr_options = {
            "condition_on_previous_text": False,
        }

        model = captioner.load_model(
            model_name,
            device=device,
            compute_type=compute_type,
            language=language,
            asr_options=asr_options,
        )

        def asr_progress(pct: float):
            # Map ASR progress from 15% to 55%
            mapped = 15.0 + (pct / 100.0) * 40.0
            update_job_status(job_id, current_step="transcribing", progress=mapped)

        logger.info("Transcribing audio...")
        result = model.transcribe(
            audio,
            batch_size=batch_size,
            progress_callback=asr_progress,
            interleaved_context=interleaved_context,
        )

        # Free Whisper GPU memory before next steps
        del model
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        update_job_status(job_id, current_step="transcription_done", progress=55.0)

        detected_language = result.get("language", language or "en")

        # 3. Forced Phoneme Alignment
        if do_align and len(result.get("segments", [])) > 0:
            update_job_status(job_id, current_step="aligning", progress=60.0)
            logger.info(f"Aligning phonemes for language '{detected_language}'...")

            try:
                align_model, align_metadata = captioner.load_align_model(
                    language_code=detected_language,
                    device=device,
                )

                def align_progress(pct: float):
                    # Map alignment progress from 60% to 75%
                    mapped = 60.0 + (pct / 100.0) * 15.0
                    update_job_status(job_id, current_step="aligning", progress=mapped)

                result = captioner.align(
                    result["segments"],
                    align_model,
                    align_metadata,
                    audio,
                    device,
                    return_char_alignments=False,
                    progress_callback=align_progress,
                )

                del align_model
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()

                update_job_status(job_id, current_step="alignment_done", progress=75.0)
            except Exception as align_err:
                logger.warning(f"Alignment warning/failure for job {job_id}: {align_err}")
                # Don't fail the whole job if alignment was just missing a language model
                # segments are still available from whisper
        else:
            update_job_status(job_id, progress=75.0)

        # 4. Speaker Diarization
        if do_diarize and hf_token:
            update_job_status(job_id, current_step="diarizing", progress=80.0)
            logger.info("Running Pyannote speaker diarization...")
            try:
                from captioner.diarize import DiarizationPipeline, assign_word_speakers
                diarize_model = DiarizationPipeline(token=hf_token, device=device)

                def diarize_progress(pct: float):
                    mapped = 80.0 + (pct / 100.0) * 15.0
                    update_job_status(job_id, current_step="diarizing", progress=mapped)

                diarize_segments = diarize_model(
                    file_path,
                    min_speakers=min_speakers,
                    max_speakers=max_speakers,
                    progress_callback=diarize_progress,
                )

                result = assign_word_speakers(diarize_segments, result)

                del diarize_model
                gc.collect()
                if torch.cuda.is_available():
                    torch.cuda.empty_cache()

                update_job_status(job_id, current_step="diarization_done", progress=95.0)
            except Exception as diarize_err:
                logger.error(f"Diarization failed for job {job_id}: {diarize_err}")
                # Diarization error shouldn't lose the transcript
                result["diarization_error"] = str(diarize_err)
        elif do_diarize and not hf_token:
            result["diarization_error"] = "Hugging Face token was not provided."

        # 5. Format & Finalize
        # Ensure result has clean serializable structures
        clean_segments = []
        for s in result.get("segments", []):
            seg_dict = {
                "start": round(s.get("start", 0.0), 3),
                "end": round(s.get("end", 0.0), 3),
                "text": s.get("text", "").strip(),
                "speaker": s.get("speaker"),
            }
            if "words" in s and s["words"]:
                seg_dict["words"] = [
                    {
                        "word": w.get("word", ""),
                        "start": round(w.get("start", 0.0), 3) if "start" in w and w["start"] is not None else None,
                        "end": round(w.get("end", 0.0), 3) if "end" in w and w["end"] is not None else None,
                        "score": round(w.get("score", 0.0), 3) if "score" in w and w["score"] is not None else None,
                        "speaker": w.get("speaker"),
                    }
                    for w in s["words"]
                ]
            clean_segments.append(seg_dict)

        final_result = {
            "segments": clean_segments,
            "language": detected_language,
            "duration": round(duration, 2),
        }
        if "word_segments" in result:
            final_result["word_segments"] = result["word_segments"]

        update_job_status(
            job_id,
            status="completed",
            current_step="completed",
            progress=100.0,
            result_data=final_result,
        )
        logger.info(f"Job {job_id} successfully completed!")

    except Exception as e:
        error_msg = f"{type(e).__name__}: {str(e)}\n{traceback.format_exc()}"
        logger.error(f"Error processing job {job_id}: {error_msg}")
        update_job_status(
            job_id,
            status="failed",
            current_step="failed",
            error_message=str(e),
        )


def worker_loop():
    """Worker loop that continuously consumes jobs from job_queue."""
    logger.info("Captioner Studio background worker started.")
    while True:
        try:
            job_id = job_queue.get()
            if job_id is None:
                break
            process_transcription_job(job_id)
        except Exception as e:
            logger.error(f"Unexpected worker exception: {e}")
        finally:
            job_queue.task_done()


_worker_thread: Optional[threading.Thread] = None

def start_worker():
    global _worker_thread
    if _worker_thread is None or not _worker_thread.is_alive():
        _worker_thread = threading.Thread(target=worker_loop, daemon=True)
        _worker_thread.start()


def queue_job(job_id: str):
    """Enqueue a job to the background worker."""
    active_jobs[job_id] = {
        "status": "pending",
        "current_step": "queued",
        "progress": 0.0,
        "error": None,
    }
    job_queue.put(job_id)
