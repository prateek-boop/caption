import importlib


def _lazy_import(name):
    module = importlib.import_module(f"captioner.{name}")
    return module


def load_align_model(*args, **kwargs):
    alignment = _lazy_import("alignment")
    return alignment.load_align_model(*args, **kwargs)


def align(*args, **kwargs):
    alignment = _lazy_import("alignment")
    return alignment.align(*args, **kwargs)


def load_model(*args, **kwargs):
    asr = _lazy_import("asr")
    return asr.load_model(*args, **kwargs)


def load_audio(*args, **kwargs):
    audio = _lazy_import("audio")
    return audio.load_audio(*args, **kwargs)


def assign_word_speakers(*args, **kwargs):
    diarize = _lazy_import("diarize")
    return diarize.assign_word_speakers(*args, **kwargs)


def setup_logging(*args, **kwargs):
    """
    Configure logging for Captioner.

    Args:
        level: Logging level (debug, info, warning, error, critical). Default: warning
        log_file: Optional path to log file. If None, logs only to console.
    """
    logging_module = _lazy_import("log_utils")
    return logging_module.setup_logging(*args, **kwargs)


def get_logger(*args, **kwargs):
    """
    Get a logger instance for the given module.

    Args:
        name: Logger name (typically __name__ from calling module)

    Returns:
        Logger instance configured with Captioner settings
    """
    logging_module = _lazy_import("log_utils")
    return logging_module.get_logger(*args, **kwargs)


def clip_media(*args, **kwargs):
    """Clip audio or video file with frame accuracy and optional subtitle burning."""
    clipper_module = _lazy_import("clipper")
    return clipper_module.clip_media(*args, **kwargs)


def probe_media(*args, **kwargs):
    """Probe audio or video file using ffprobe."""
    clipper_module = _lazy_import("clipper")
    return clipper_module.probe_media(*args, **kwargs)


def slice_transcript(*args, **kwargs):
    """Slice transcript and word timestamps to fit within a time range."""
    clipper_module = _lazy_import("clipper")
    return clipper_module.slice_transcript(*args, **kwargs)

