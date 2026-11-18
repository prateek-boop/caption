import os
import sys
import math
import wave
import struct
import shutil
import tempfile
import subprocess
import unittest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

from captioner.clipper import (
    parse_timestamp,
    format_seconds_to_timestamp,
    probe_media,
    slice_transcript,
    clip_media,
    escape_ffmpeg_filter_path,
    ClipperError,
    InvalidMediaFileError,
)


def create_dummy_wav(filepath: str, duration_secs: float = 3.0, sample_rate: int = 16000):
    """Create a valid synthetic mono WAV file."""
    with wave.open(filepath, "wb") as wav_file:
        wav_file.setnchannels(1)
        wav_file.setsampwidth(2)
        wav_file.setframerate(sample_rate)
        num_samples = int(duration_secs * sample_rate)
        data = bytearray()
        for i in range(num_samples):
            val = int(32767.0 * 0.3 * math.sin(2.0 * math.pi * 440.0 * i / sample_rate))
            data.extend(struct.pack("<h", val))
        wav_file.writeframes(data)


def create_synthetic_mp4(filepath: str, duration_secs: float = 3.0):
    """Create a valid synthetic MP4 video file with audio track using FFmpeg."""
    cmd = [
        "ffmpeg", "-y", "-nostdin",
        "-f", "lavfi", "-i", f"testsrc=duration={duration_secs}:size=320x240:rate=25",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration_secs}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        filepath
    ]
    subprocess.run(cmd, capture_output=True, check=True)


class TestTimestampParsing(unittest.TestCase):
    def test_float_and_int(self):
        self.assertEqual(parse_timestamp(15), 15.0)
        self.assertEqual(parse_timestamp(23.75), 23.75)
        self.assertEqual(parse_timestamp(0), 0.0)

    def test_string_seconds(self):
        self.assertEqual(parse_timestamp("45.2"), 45.2)
        self.assertEqual(parse_timestamp("12"), 12.0)

    def test_string_mm_ss(self):
        self.assertEqual(parse_timestamp("02:15.5"), 135.5)
        self.assertEqual(parse_timestamp("1:30"), 90.0)

    def test_string_hh_mm_ss(self):
        self.assertEqual(parse_timestamp("01:02:03.500"), 3723.5)
        self.assertEqual(parse_timestamp("00:01:23,456"), 83.456)

    def test_invalid_timestamps(self):
        with self.assertRaises(ValueError):
            parse_timestamp(-5)
        with self.assertRaises(ValueError):
            parse_timestamp("-01:00")
        with self.assertRaises(ValueError):
            parse_timestamp("invalid")
        with self.assertRaises(ValueError):
            parse_timestamp("")

    def test_format_seconds(self):
        self.assertEqual(format_seconds_to_timestamp(83.456), "00:01:23.456")
        self.assertEqual(format_seconds_to_timestamp(0), "00:00:00.000")


class TestTranscriptSlicing(unittest.TestCase):
    def test_slice_transcript_basic(self):
        transcript = {
            "language": "en",
            "segments": [
                {
                    "start": 0.0,
                    "end": 2.0,
                    "text": "Hello world",
                    "speaker": "SPEAKER_00",
                    "words": [
                        {"word": "Hello", "start": 0.0, "end": 0.9},
                        {"word": "world", "start": 1.0, "end": 2.0},
                    ]
                },
                {
                    "start": 2.5,
                    "end": 5.0,
                    "text": "This is a test recording",
                    "speaker": "SPEAKER_01",
                    "words": [
                        {"word": "This", "start": 2.5, "end": 3.0},
                        {"word": "is", "start": 3.1, "end": 3.4},
                        {"word": "a", "start": 3.5, "end": 3.7},
                        {"word": "test", "start": 3.8, "end": 4.2},
                        {"word": "recording", "start": 4.3, "end": 5.0},
                    ]
                },
                {
                    "start": 6.0,
                    "end": 8.0,
                    "text": "Out of range segment",
                    "speaker": "SPEAKER_00",
                }
            ]
        }

        # Slice between 1.5s and 4.0s (duration = 2.5s)
        sliced = slice_transcript(transcript, start_time=1.5, end_time=4.0)

        self.assertEqual(sliced["duration"], 2.5)
        self.assertEqual(len(sliced["segments"]), 2)

        # First sliced segment: 1.5 to 2.0 -> relative: 0.0 to 0.5
        seg0 = sliced["segments"][0]
        self.assertEqual(seg0["start"], 0.0)
        self.assertEqual(seg0["end"], 0.5)
        self.assertEqual(seg0["speaker"], "SPEAKER_00")
        self.assertEqual(len(seg0["words"]), 1)
        self.assertEqual(seg0["words"][0]["word"], "world")
        self.assertEqual(seg0["words"][0]["start"], 0.0)
        self.assertEqual(seg0["words"][0]["end"], 0.5)

        # Second sliced segment: 2.5 to 4.0 -> relative: 1.0 to 2.5
        seg1 = sliced["segments"][1]
        self.assertEqual(seg1["start"], 1.0)
        self.assertEqual(seg1["end"], 2.5)
        self.assertEqual(seg1["speaker"], "SPEAKER_01")


class TestMediaProbingAndClipping(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp(prefix="test_captioner_clipper_")

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def test_probe_and_clip_audio(self):
        wav_path = os.path.join(self.temp_dir, "test_audio.wav")
        create_dummy_wav(wav_path, duration_secs=4.0)

        # 1. Probe
        info = probe_media(wav_path)
        self.assertTrue(info.has_audio)
        self.assertFalse(info.has_video)
        self.assertTrue(3.9 <= info.duration <= 4.1)

        # 2. Exact Clip (1.0s to 3.0s)
        out_wav = os.path.join(self.temp_dir, "clipped.wav")
        out_path, meta = clip_media(wav_path, output_path=out_wav, start_time=1.0, end_time=3.0, mode="exact")

        self.assertTrue(os.path.exists(out_path))
        out_info = probe_media(out_path)
        self.assertTrue(out_info.has_audio)
        self.assertTrue(1.9 <= out_info.duration <= 2.1)
        self.assertEqual(meta["duration"], out_info.duration)

    def test_clip_audio_to_mp3(self):
        wav_path = os.path.join(self.temp_dir, "test_convert.wav")
        create_dummy_wav(wav_path, duration_secs=3.0)

        out_mp3 = os.path.join(self.temp_dir, "clipped.mp3")
        out_path, meta = clip_media(wav_path, output_path=out_mp3, start_time=0.5, end_time=2.5, target_format="mp3")

        self.assertTrue(os.path.exists(out_path))
        self.assertTrue(out_path.endswith(".mp3"))
        info = probe_media(out_path)
        self.assertTrue(info.has_audio)
        self.assertEqual(info.audio_stream.codec_name, "mp3")
        self.assertTrue(1.9 <= info.duration <= 2.1)

    def test_clip_video_exact_and_burn_subtitles(self):
        mp4_path = os.path.join(self.temp_dir, "test_video.mp4")
        create_synthetic_mp4(mp4_path, duration_secs=3.5)

        # Probe video
        info = probe_media(mp4_path)
        self.assertTrue(info.has_video)
        self.assertTrue(info.has_audio)
        self.assertTrue(3.4 <= info.duration <= 3.6)

        # Clip video with burned subtitles
        dummy_transcript = {
            "language": "en",
            "segments": [
                {"start": 1.0, "end": 2.5, "text": "Burning captions into video!", "speaker": "SPEAKER_00"}
            ]
        }

        out_mp4 = os.path.join(self.temp_dir, "clipped_burnt.mp4")
        out_path, meta = clip_media(
            mp4_path,
            output_path=out_mp4,
            start_time=0.5,
            end_time=2.5,
            burn_subtitles=True,
            subtitles_data=dummy_transcript,
            mode="exact",
        )

        self.assertTrue(os.path.exists(out_path))
        out_info = probe_media(out_path)
        self.assertTrue(out_info.has_video)
        self.assertTrue(out_info.has_audio)
        self.assertTrue(1.9 <= out_info.duration <= 2.1)
        self.assertTrue(meta["burned_subtitles"])
        self.assertIn("sliced_transcript", meta)

    def test_error_handling(self):
        wav_path = os.path.join(self.temp_dir, "test_err.wav")
        create_dummy_wav(wav_path, duration_secs=2.0)

        # Non-existent file
        with self.assertRaises(FileNotFoundError):
            probe_media("non_existent_file_xyz.mp4")

        # start_time exceeds duration
        with self.assertRaises(ValueError):
            clip_media(wav_path, start_time=5.0, end_time=6.0)

        # end_time <= start_time
        with self.assertRaises(ValueError):
            clip_media(wav_path, start_time=1.5, end_time=1.0)

        # burn subtitles on audio-only
        with self.assertRaises(ClipperError):
            clip_media(wav_path, start_time=0.0, end_time=1.0, burn_subtitles=True, subtitles_data={"segments": []})


if __name__ == "__main__":
    unittest.main()
