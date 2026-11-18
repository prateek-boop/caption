"""
Captioner Media Clipping Module
Universal, frame-accurate, zero-flaw audio and video clipping with subtitle burning,
stream copy, and transcript slicing.
"""

import os
import re
import sys
import json
import shutil
import tempfile
import subprocess
from dataclasses import dataclass
from typing import Optional, Union, Dict, Any, List, Tuple, Callable

# Ensure package can be run directly as a script
if __name__ == "__main__" and __package__ is None:
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if repo_root not in sys.path:
        sys.path.insert(0, repo_root)

from captioner.log_utils import get_logger

logger = get_logger(__name__)


class ClipperError(Exception):
    """Exception raised for media clipping errors."""
    pass


class InvalidMediaFileError(ClipperError):
    """Exception raised when media file is invalid or cannot be probed."""
    pass


@dataclass
class MediaStreamInfo:
    index: int
    codec_type: str  # 'video', 'audio', 'subtitle'
    codec_name: str
    width: Optional[int] = None
    height: Optional[int] = None
    fps: Optional[float] = None
    sample_rate: Optional[int] = None
    channels: Optional[int] = None
    bit_rate: Optional[int] = None
    duration: Optional[float] = None


@dataclass
class MediaInfo:
    file_path: str
    format_name: str
    duration: float
    bit_rate: Optional[int]
    file_size: int
    has_video: bool
    has_audio: bool
    streams: List[MediaStreamInfo]
    video_stream: Optional[MediaStreamInfo] = None
    audio_stream: Optional[MediaStreamInfo] = None


def parse_timestamp(val: Union[int, float, str]) -> float:
    """
    Parse a timestamp into seconds (float).
    Accepts:
      - float or int: 12.34
      - "HH:MM:SS.mmm" or "HH:MM:SS,mmm": "01:23:45.678"
      - "MM:SS.mmm" or "MM:SS,mmm": "02:15.5"
      - "SS.mmm" or "SS": "45.2"
    """
    if isinstance(val, (int, float)):
        if val < 0:
            raise ValueError(f"Timestamp cannot be negative: {val}")
        return float(val)

    if not isinstance(val, str):
        raise ValueError(f"Unsupported timestamp type: {type(val)} ({val})")

    s = val.strip().replace(",", ".")
    if not s:
        raise ValueError("Timestamp string cannot be empty")

    parts = s.split(":")
    try:
        if len(parts) == 3:  # HH:MM:SS.sss
            hours = float(parts[0])
            minutes = float(parts[1])
            seconds = float(parts[2])
            total = hours * 3600.0 + minutes * 60.0 + seconds
        elif len(parts) == 2:  # MM:SS.sss
            minutes = float(parts[0])
            seconds = float(parts[1])
            total = minutes * 60.0 + seconds
        elif len(parts) == 1:  # SS.sss
            total = float(parts[0])
        else:
            raise ValueError(f"Invalid timestamp format: {val}")

        if total < 0:
            raise ValueError(f"Timestamp cannot be negative: {val}")
        return total
    except ValueError as e:
        raise ValueError(f"Could not parse timestamp '{val}': {e}") from e


def format_seconds_to_timestamp(seconds: float, delimiter: str = ".") -> str:
    """Format seconds into HH:MM:SS.mmm."""
    if seconds is None or seconds < 0:
        seconds = 0.0
    millis = int(round((seconds - int(seconds)) * 1000))
    total_seconds = int(seconds)
    hours = total_seconds // 3600
    minutes = (total_seconds % 3600) // 60
    secs = total_seconds % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}{delimiter}{millis:03d}"


def probe_media(file_path: str) -> MediaInfo:
    """
    Probe media file using ffprobe and return structured MediaInfo.
    Supports all audio and video formats recognized by FFmpeg.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Media file not found: {file_path}")

    if not os.path.isfile(file_path):
        raise InvalidMediaFileError(f"Path is not a regular file: {file_path}")

    file_size = os.path.getsize(file_path)
    if file_size == 0:
        raise InvalidMediaFileError(f"Media file is empty (0 bytes): {file_path}")

    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_format",
        "-show_streams",
        "-print_format", "json",
        file_path,
    ]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True)
    except subprocess.CalledProcessError as e:
        err = e.stderr.strip() if e.stderr else str(e)
        raise InvalidMediaFileError(f"ffprobe failed for '{file_path}': {err}") from e
    except FileNotFoundError as e:
        raise ClipperError("ffprobe is not installed or not in PATH. Please install FFmpeg.") from e

    try:
        data = json.loads(res.stdout)
    except json.JSONDecodeError as e:
        raise InvalidMediaFileError(f"Failed to parse ffprobe JSON output: {e}") from e

    fmt = data.get("format", {})
    streams_raw = data.get("streams", [])

    duration = 0.0
    if "duration" in fmt and fmt["duration"] is not None:
        try:
            duration = float(fmt["duration"])
        except (ValueError, TypeError):
            pass

    streams: List[MediaStreamInfo] = []
    has_video = False
    has_audio = False
    video_stream_obj: Optional[MediaStreamInfo] = None
    audio_stream_obj: Optional[MediaStreamInfo] = None

    for s in streams_raw:
        codec_type = s.get("codec_type")
        codec_name = s.get("codec_name", "unknown")
        disposition = s.get("disposition", {})

        # Ignore attached picture / album cover as primary video stream
        is_attached_pic = bool(disposition.get("attached_pic", 0))

        stream_dur = None
        if "duration" in s and s["duration"] is not None:
            try:
                stream_dur = float(s["duration"])
            except (ValueError, TypeError):
                pass

        fps = None
        if codec_type == "video":
            r_fps = s.get("r_frame_rate", "")
            if "/" in r_fps:
                num, den = r_fps.split("/")
                try:
                    if float(den) > 0:
                        fps = round(float(num) / float(den), 3)
                except (ValueError, ZeroDivisionError):
                    pass

        s_info = MediaStreamInfo(
            index=int(s.get("index", 0)),
            codec_type=codec_type or "unknown",
            codec_name=codec_name,
            width=s.get("width"),
            height=s.get("height"),
            fps=fps,
            sample_rate=int(s["sample_rate"]) if "sample_rate" in s and s["sample_rate"] else None,
            channels=int(s["channels"]) if "channels" in s and s["channels"] else None,
            bit_rate=int(s["bit_rate"]) if "bit_rate" in s and s["bit_rate"] else None,
            duration=stream_dur,
        )
        streams.append(s_info)

        if codec_type == "video" and not is_attached_pic and video_stream_obj is None:
            has_video = True
            video_stream_obj = s_info
            if duration == 0.0 and stream_dur:
                duration = stream_dur

        elif codec_type == "audio" and audio_stream_obj is None:
            has_audio = True
            audio_stream_obj = s_info
            if duration == 0.0 and stream_dur:
                duration = stream_dur

    if not has_video and not has_audio:
        raise InvalidMediaFileError(f"No valid audio or video streams found in '{file_path}'")

    bit_rate = None
    if "bit_rate" in fmt and fmt["bit_rate"]:
        try:
            bit_rate = int(fmt["bit_rate"])
        except (ValueError, TypeError):
            pass

    return MediaInfo(
        file_path=file_path,
        format_name=fmt.get("format_name", "unknown"),
        duration=round(duration, 3),
        bit_rate=bit_rate,
        file_size=file_size,
        has_video=has_video,
        has_audio=has_audio,
        streams=streams,
        video_stream=video_stream_obj,
        audio_stream=audio_stream_obj,
    )


def escape_ffmpeg_filter_path(path: str) -> str:
    """
    Escape file path for FFmpeg filter arguments (like subtitles='...').
    Escapes colons, backslashes, single quotes, and brackets.
    """
    clean = path.replace("\\", "/")
    # In ffmpeg filter syntax:
    # ':' must be escaped as '\:'
    # '\'' must be escaped as '\'\\\'\'' or '\\\''
    # '[' and ']' must be escaped as '\[' and '\]'
    escaped = ""
    for ch in clean:
        if ch == ":":
            escaped += "\\:"
        elif ch == "'":
            escaped += "'\\''"
        elif ch in ("[", "]"):
            escaped += "\\" + ch
        elif ch == "\\":
            escaped += "\\\\"
        else:
            escaped += ch
    return escaped


def slice_transcript(
    transcript: Dict[str, Any],
    start_time: float,
    end_time: float,
) -> Dict[str, Any]:
    """
    Slice transcript segments and word timestamps to fit within [start_time, end_time].
    Timestamps in the returned transcript are re-indexed relative to 0.0.
    """
    clip_duration = max(0.0, end_time - start_time)
    original_segments = transcript.get("segments", [])
    sliced_segments: List[Dict[str, Any]] = []

    for seg in original_segments:
        s_start = float(seg.get("start", 0.0))
        s_end = float(seg.get("end", 0.0))

        # Check for segment overlap with [start_time, end_time]
        if s_end <= start_time or s_start >= end_time:
            continue

        # Clamp segment boundaries
        clamped_start = max(s_start, start_time)
        clamped_end = min(s_end, end_time)

        rel_start = round(clamped_start - start_time, 3)
        rel_end = round(clamped_end - start_time, 3)

        # Slice words if available
        sliced_words: List[Dict[str, Any]] = []
        if "words" in seg and seg["words"]:
            for w in seg["words"]:
                w_start = w.get("start")
                w_end = w.get("end")
                if w_start is None or w_end is None:
                    sliced_words.append(dict(w))
                    continue

                w_start = float(w_start)
                w_end = float(w_end)

                if w_end <= start_time or w_start >= end_time:
                    continue

                clamped_w_start = round(max(w_start, start_time) - start_time, 3)
                clamped_w_end = round(min(w_end, end_time) - start_time, 3)

                new_word = dict(w)
                new_word["start"] = clamped_w_start
                new_word["end"] = clamped_w_end
                sliced_words.append(new_word)

        new_seg = {
            "start": rel_start,
            "end": rel_end,
            "text": seg.get("text", "").strip(),
            "speaker": seg.get("speaker"),
        }
        if sliced_words:
            new_seg["words"] = sliced_words
            # Reconstruct text from sliced words if segment was cut partially
            if s_start < start_time or s_end > end_time:
                words_text = " ".join(w.get("word", "").strip() for w in sliced_words if w.get("word"))
                if words_text:
                    new_seg["text"] = words_text

        sliced_segments.append(new_seg)

    result = {
        "segments": sliced_segments,
        "language": transcript.get("language", "en"),
        "duration": round(clip_duration, 3),
    }
    return result


def export_srt_from_segments(segments: List[Dict[str, Any]]) -> str:
    """Generate SRT formatted string from segments."""
    lines: List[str] = []
    idx = 1
    for seg in segments:
        start_ts = format_seconds_to_timestamp(seg.get("start", 0.0), delimiter=",")
        end_ts = format_seconds_to_timestamp(seg.get("end", 0.0), delimiter=",")
        text = seg.get("text", "").strip()
        speaker = seg.get("speaker")

        lines.append(str(idx))
        lines.append(f"{start_ts} --> {end_ts}")
        if speaker:
            lines.append(f"[{speaker}]: {text}")
        else:
            lines.append(text)
        lines.append("")
        idx += 1
    return "\n".join(lines)


def clip_media(
    input_path: str,
    output_path: Optional[str] = None,
    start_time: Union[int, float, str] = 0.0,
    end_time: Optional[Union[int, float, str]] = None,
    mode: str = "exact",
    burn_subtitles: bool = False,
    subtitles_path: Optional[str] = None,
    subtitles_data: Optional[Dict[str, Any]] = None,
    target_format: Optional[str] = None,
    audio_bitrate: str = "192k",
    video_crf: int = 18,
    progress_callback: Optional[Callable[[float], None]] = None,
) -> Tuple[str, Dict[str, Any]]:
    """
    Clip any audio or video file with frame accuracy, format conversion, and optional subtitle burning.

    Parameters:
      input_path: Source media file path (supports all formats via FFmpeg).
      output_path: Output file path. If None, generated in the same directory or temp dir.
      start_time: Start timestamp (float, int, or 'HH:MM:SS.mmm' string).
      end_time: End timestamp (float, int, or 'HH:MM:SS.mmm' string). None means until end of file.
      mode: 'exact' (frame-accurate re-encode, 0 glitches) or 'fast' (stream copy).
      burn_subtitles: Whether to burn subtitles directly into the video stream.
      subtitles_path: Path to an SRT or ASS file to burn.
      subtitles_data: Transcript dict to burn (will be sliced to match clip start_time).
      target_format: Container format extension ('mp4', 'mp3', 'wav', 'webm', 'mkv', etc.).
      audio_bitrate: Audio bitrate (default '192k').
      video_crf: Video CRF (default 18 for high fidelity).
      progress_callback: Optional callback receiving float percentage (0.0 to 100.0).

    Returns:
      (final_output_path, clip_metadata)
    """
    info = probe_media(input_path)

    start_sec = parse_timestamp(start_time)
    if info.duration > 0 and start_sec >= info.duration:
        raise ValueError(
            f"start_time ({start_sec}s) exceeds media duration ({info.duration}s)"
        )

    if end_time is not None:
        end_sec = parse_timestamp(end_time)
        if end_sec <= start_sec:
            raise ValueError(
                f"end_time ({end_sec}s) must be greater than start_time ({start_sec}s)"
            )
        if info.duration > 0 and end_sec > info.duration:
            logger.warning(
                f"end_time ({end_sec}s) exceeds media duration ({info.duration}s); clamping to duration."
            )
            end_sec = info.duration
    else:
        end_sec = info.duration if info.duration > 0 else (start_sec + 60.0)

    clip_duration = max(0.001, end_sec - start_sec)

    # Determine target container format & output path
    input_ext = os.path.splitext(input_path)[1].lower().lstrip(".")
    if target_format:
        ext = target_format.lower().lstrip(".")
    else:
        # Default: if video, mp4; if audio-only, keep or use mp3
        if info.has_video:
            ext = input_ext if input_ext in ("mp4", "mkv", "webm", "mov") else "mp4"
        else:
            ext = input_ext if input_ext in ("mp3", "wav", "m4a", "ogg", "flac", "aac") else "mp3"

    if output_path is None:
        base_dir = os.path.dirname(os.path.abspath(input_path))
        base_name = os.path.splitext(os.path.basename(input_path))[0]
        timestamp_tag = f"clip_{int(start_sec)}_{int(end_sec)}"
        output_path = os.path.join(base_dir, f"{base_name}_{timestamp_tag}.{ext}")

    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    # Temporary directory for intermediate files (e.g. generated srt for burning)
    temp_dir = tempfile.mkdtemp(prefix="captioner_clip_")
    temp_srt_path: Optional[str] = None

    try:
        # Subtitle burning & transcript slicing setup
        actual_subtitles_to_burn: Optional[str] = None
        sliced_transcript_data: Optional[Dict[str, Any]] = None

        if subtitles_data:
            sliced_transcript_data = slice_transcript(subtitles_data, start_sec, end_sec)

        if burn_subtitles:
            if not info.has_video:
                raise ClipperError("Cannot burn subtitles into an audio-only file. Video stream required.")

            if sliced_transcript_data:
                srt_content = export_srt_from_segments(sliced_transcript_data["segments"])
                temp_srt_path = os.path.join(temp_dir, "burn_subtitles.srt")
                with open(temp_srt_path, "w", encoding="utf-8") as f:
                    f.write(srt_content)
                actual_subtitles_to_burn = temp_srt_path

            elif subtitles_path and os.path.exists(subtitles_path):
                actual_subtitles_to_burn = subtitles_path
            else:
                raise ClipperError("burn_subtitles is True but neither subtitles_data nor subtitles_path was provided.")

            # Subtitle burning requires exact re-encoding
            mode = "exact"

        # Build FFmpeg command
        cmd: List[str] = ["ffmpeg", "-y", "-nostdin"]

        # Accurate seeking:
        # Using -ss <start> -i <input> -t <duration> provides fast seek + frame-accurate decoding
        cmd.extend(["-ss", f"{start_sec:.3f}"])
        cmd.extend(["-i", input_path])
        cmd.extend(["-t", f"{clip_duration:.3f}"])

        is_audio_output = ext in ("mp3", "wav", "m4a", "ogg", "flac", "aac")

        if is_audio_output:
            # Extract/clip audio only
            cmd.append("-vn")  # disable video
            if mode == "fast" and not info.has_video and input_ext == ext:
                cmd.extend(["-c:a", "copy"])
            else:
                if ext == "mp3":
                    cmd.extend(["-c:a", "libmp3lame", "-b:a", audio_bitrate])
                elif ext == "wav":
                    cmd.extend(["-c:a", "pcm_s16le"])
                elif ext == "m4a" or ext == "aac":
                    cmd.extend(["-c:a", "aac", "-b:a", audio_bitrate])
                elif ext == "ogg":
                    cmd.extend(["-c:a", "libvorbis", "-q:a", "4"])
                elif ext == "flac":
                    cmd.extend(["-c:a", "flac"])
                else:
                    cmd.extend(["-c:a", "aac", "-b:a", audio_bitrate])

        else:
            # Video output
            if mode == "fast" and not actual_subtitles_to_burn and input_ext == ext:
                # Fast stream copy without re-encoding
                cmd.extend(["-c", "copy", "-avoid_negative_ts", "1"])
            else:
                # Exact frame-accurate re-encode
                video_filters = []
                if actual_subtitles_to_burn:
                    escaped_srt = escape_ffmpeg_filter_path(actual_subtitles_to_burn)
                    # Beautiful modern crisp styling
                    style = (
                        "force_style="
                        "'FontName=Sans,FontSize=20,PrimaryColour=&H00FFFFFF,"
                        "OutlineColour=&H00000000,BorderStyle=3,Outline=1.6,"
                        "Shadow=0,MarginV=25,Alignment=2'"
                    )
                    video_filters.append(f"subtitles='{escaped_srt}':{style}")

                if video_filters:
                    cmd.extend(["-vf", ",".join(video_filters)])

                # Universal H.264 / AAC web encoding
                if ext == "webm":
                    cmd.extend(["-c:v", "libvpx-vp9", "-crf", "30", "-b:v", "0"])
                    cmd.extend(["-c:a", "libopus", "-b:a", "128k"])
                else:
                    cmd.extend([
                        "-c:v", "libx264",
                        "-preset", "fast",
                        "-crf", str(video_crf),
                        "-pix_fmt", "yuv420p",
                    ])
                    if info.has_audio:
                        cmd.extend(["-c:a", "aac", "-b:a", audio_bitrate])

                cmd.extend(["-avoid_negative_ts", "make_zero"])

        cmd.extend(["-max_muxing_queue_size", "2048"])
        cmd.append(output_path)

        if progress_callback:
            progress_callback(10.0)

        logger.info(f"Executing clip command: {' '.join(cmd)}")

        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
        )
        _, stderr_output = process.communicate()

        if process.returncode != 0:
            raise ClipperError(f"FFmpeg clipping failed (exit {process.returncode}):\n{stderr_output.strip()}")

        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            raise ClipperError(f"Clipped file was not produced or is 0 bytes: {output_path}")

        if progress_callback:
            progress_callback(100.0)

        out_info = probe_media(output_path)
        meta = {
            "input_file": input_path,
            "output_file": output_path,
            "start_time": start_sec,
            "end_time": end_sec,
            "duration": out_info.duration,
            "file_size": out_info.file_size,
            "mode": mode,
            "burned_subtitles": bool(actual_subtitles_to_burn),
            "format": out_info.format_name,
            "has_video": out_info.has_video,
            "has_audio": out_info.has_audio,
        }
        if sliced_transcript_data:
            meta["sliced_transcript"] = sliced_transcript_data

        return output_path, meta

    finally:
        shutil.rmtree(temp_dir, ignore_errors=True)


def cli_main():
    """Command line interface for captioner-clip."""
    import argparse
    parser = argparse.ArgumentParser(
        prog="captioner-clip",
        description="High-precision audio and video clipping tool with universal format support and subtitle burning."
    )
    parser.add_argument("input", help="Path to input audio or video file")
    parser.add_argument("-o", "--output", default=None, help="Path for output clipped media file")
    parser.add_argument("-s", "--start", default="0", help="Start timestamp in seconds or HH:MM:SS.mmm (default: 0)")
    parser.add_argument("-e", "--end", default=None, help="End timestamp in seconds or HH:MM:SS.mmm (default: end of media)")
    parser.add_argument("-d", "--duration", default=None, help="Duration of clip in seconds (alternative to --end)")
    parser.add_argument("-m", "--mode", choices=["exact", "fast"], default="exact", help="Clipping mode: 'exact' (frame-accurate re-encode) or 'fast' (stream copy)")
    parser.add_argument("-f", "--format", default=None, help="Target container format (mp4, webm, mp3, wav, etc.)")
    parser.add_argument("--burn-subtitles", action="store_true", help="Burn subtitles into the video clip")
    parser.add_argument("--subtitles", default=None, help="Path to subtitle file (.srt, .ass, etc.) to burn")
    parser.add_argument("--probe", action="store_true", help="Probe media information and exit")

    args = parser.parse_args()

    if args.probe:
        info = probe_media(args.input)
        print(json.dumps({
            "file_path": info.file_path,
            "format": info.format_name,
            "duration": info.duration,
            "bit_rate": info.bit_rate,
            "has_video": info.has_video,
            "has_audio": info.has_audio,
            "streams": [
                {
                    "index": s.index,
                    "type": s.codec_type,
                    "codec": s.codec_name,
                    "width": s.width,
                    "height": s.height,
                    "fps": s.fps,
                    "sample_rate": s.sample_rate,
                    "channels": s.channels,
                }
                for s in info.streams
            ]
        }, indent=2))
        return

    end_val = args.end
    if args.duration is not None:
        start_sec = parse_timestamp(args.start)
        dur_sec = parse_timestamp(args.duration)
        end_val = start_sec + dur_sec

    out_file, meta = clip_media(
        input_path=args.input,
        output_path=args.output,
        start_time=args.start,
        end_time=end_val,
        mode=args.mode,
        burn_subtitles=args.burn_subtitles,
        subtitles_path=args.subtitles,
        target_format=args.format,
    )

    print(f"\n[OK] Clip created successfully!")
    print(f"  Output: {out_file}")
    print(f"  Duration: {meta['duration']}s ({meta['start_time']}s -> {meta['end_time']}s)")
    print(f"  Size: {meta['file_size']} bytes")
    print(f"  Mode: {meta['mode']} (Burned subtitles: {meta['burned_subtitles']})")


if __name__ == "__main__":
    cli_main()
