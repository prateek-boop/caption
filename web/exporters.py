import json
from typing import Dict, Any, List


def format_timestamp_srt(seconds: float) -> str:
    """Convert seconds to SRT timestamp format: HH:MM:SS,mmm"""
    if seconds is None:
        seconds = 0.0
    millis = int(round((seconds - int(seconds)) * 1000))
    seconds = int(seconds)
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"


def format_timestamp_vtt(seconds: float) -> str:
    """Convert seconds to WebVTT timestamp format: HH:MM:SS.mmm"""
    if seconds is None:
        seconds = 0.0
    millis = int(round((seconds - int(seconds)) * 1000))
    seconds = int(seconds)
    hours = seconds // 3600
    minutes = (seconds % 3600) // 60
    secs = seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}.{millis:03d}"


def export_srt(result_data: Dict[str, Any], include_speakers: bool = True) -> str:
    """Export transcription result to SRT format."""
    segments = result_data.get("segments", [])
    lines = []
    index = 1

    for seg in segments:
        start_ts = format_timestamp_srt(seg.get("start", 0.0))
        end_ts = format_timestamp_srt(seg.get("end", 0.0))
        text = seg.get("text", "").strip()
        speaker = seg.get("speaker")

        lines.append(str(index))
        lines.append(f"{start_ts} --> {end_ts}")
        if include_speakers and speaker:
            lines.append(f"[{speaker}]: {text}")
        else:
            lines.append(text)
        lines.append("")
        index += 1

    return "\n".join(lines)


def export_vtt(result_data: Dict[str, Any], include_speakers: bool = True) -> str:
    """Export transcription result to WebVTT format."""
    segments = result_data.get("segments", [])
    lines = ["WEBVTT", ""]

    for seg in segments:
        start_ts = format_timestamp_vtt(seg.get("start", 0.0))
        end_ts = format_timestamp_vtt(seg.get("end", 0.0))
        text = seg.get("text", "").strip()
        speaker = seg.get("speaker")

        lines.append(f"{start_ts} --> {end_ts}")
        if include_speakers and speaker:
            lines.append(f"<v {speaker}>{text}</v>")
        else:
            lines.append(text)
        lines.append("")

    return "\n".join(lines)


def export_txt(result_data: Dict[str, Any], include_speakers: bool = True, include_timestamps: bool = True) -> str:
    """Export transcription result to plain text."""
    segments = result_data.get("segments", [])
    lines = []

    for seg in segments:
        text = seg.get("text", "").strip()
        speaker = seg.get("speaker")
        start = seg.get("start", 0.0)
        end = seg.get("end", 0.0)

        parts = []
        if include_timestamps:
            parts.append(f"[{format_timestamp_srt(start)} - {format_timestamp_srt(end)}]")
        if include_speakers and speaker:
            parts.append(f"[{speaker}]")
        parts.append(text)
        lines.append(" ".join(parts))

    return "\n".join(lines)


def export_tsv(result_data: Dict[str, Any]) -> str:
    """Export transcription result to TSV format."""
    segments = result_data.get("segments", [])
    lines = ["start\tend\tspeaker\ttext"]

    for seg in segments:
        start = seg.get("start", 0.0)
        end = seg.get("end", 0.0)
        speaker = seg.get("speaker", "") or ""
        text = seg.get("text", "").strip().replace("\t", " ")
        lines.append(f"{start}\t{end}\t{speaker}\t{text}")

    return "\n".join(lines)


def export_json(result_data: Dict[str, Any]) -> str:
    """Export transcription result to nicely formatted JSON."""
    return json.dumps(result_data, indent=2, ensure_ascii=False)
