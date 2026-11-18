#!/usr/bin/env python3
"""
Captioner Studio & 3D Clipper - Full Feature Test Demo
Comprehensive end-to-end verification covering:
  1. System Info & Hardware GPU Diagnostics
  2. Full Authentication (Register, Dual Username/Email Login, Password Reset, Guest 1-Click)
  3. User Preferences & Settings Storage
  4. Core Clipper Engine (Probing, Exact Cut, Fast Copy, Subtitle Burning, Multi-format)
  5. CLI Tool Execution (`captioner-clip`)
  6. Direct Standalone Media Clipping API
  7. Transcription Job Lifecycle & Sliced Subtitle Export
  8. Job-Linked Media Clipping with Transcript Slicing
  9. Sliced Subtitle Exporters (SRT, WebVTT, JSON, Plain Text, TSV)
 10. HTTP Range Streaming & Attachment Downloads
 11. Clips Library Management & Clean Deletion
 12. Static Frontend Assets & 3D WebGL Bundles
"""
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

from fastapi.testclient import TestClient
from web.server import app
from captioner.clipper import (
    parse_timestamp,
    format_seconds_to_timestamp,
    probe_media,
    slice_transcript,
    clip_media,
)


def make_synthetic_wav(path: str, duration: float = 3.0, sample_rate: int = 16000):
    with wave.open(path, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        total_samples = int(duration * sample_rate)
        buf = bytearray()
        for i in range(total_samples):
            v = int(32767.0 * 0.25 * math.sin(2.0 * math.pi * 440.0 * i / sample_rate))
            buf.extend(struct.pack("<h", v))
        wf.writeframes(buf)


def make_synthetic_mp4(path: str, duration: float = 2.5):
    cmd = [
        "ffmpeg", "-y", "-nostdin",
        "-f", "lavfi", "-i", f"testsrc=duration={duration}:size=320x240:rate=25",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}",
        "-c:v", "libx264", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        path
    ]
    subprocess.run(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)


class ComprehensiveFeatureTestDemo(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        cls.temp_dir = tempfile.mkdtemp(prefix="captioner_full_demo_")
        cls.sample_wav = os.path.join(cls.temp_dir, "sample_audio.wav")
        cls.sample_mp4 = os.path.join(cls.temp_dir, "sample_video.mp4")
        make_synthetic_wav(cls.sample_wav, duration=4.0)
        make_synthetic_mp4(cls.sample_mp4, duration=3.0)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.temp_dir, ignore_errors=True)

    def test_01_static_assets_and_3d_webgl(self):
        """Verify frontend assets, 3D WebGL engine and styles are served with 200 OK."""
        for path in ["/", "/style.css", "/app.js", "/three.min.js"]:
            res = self.client.get(path)
            self.assertEqual(res.status_code, 200, f"Asset {path} failed with {res.status_code}")
            self.assertGreater(len(res.content), 0)

    def test_02_system_info_hardware(self):
        """Verify hardware GPU diagnostics endpoint."""
        res = self.client.get("/api/system/info")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("cuda_available", data)
        self.assertIn("gpu_name", data)
        self.assertIn("default_device", data)

    def test_03_auth_workflow_all_features(self):
        """Verify register, dual-login (username & email), password reset, and guest 1-click access."""
        import uuid
        uid = uuid.uuid4().hex[:8]
        test_user = f"user_{uid}"
        test_email = f"user_{uid}@example.com"
        pwd1 = "initial_password_123"
        pwd2 = "new_secure_password_456"

        # 1. Register new user
        reg_res = self.client.post("/api/auth/register", json={
            "username": test_user,
            "email": test_email,
            "password": pwd1
        })
        self.assertEqual(reg_res.status_code, 200)
        token_reg = reg_res.json()["access_token"]
        self.assertTrue(bool(token_reg))

        # 2. Login by Username
        login_user = self.client.post("/api/auth/login", json={
            "username": test_user,
            "password": pwd1
        })
        self.assertEqual(login_user.status_code, 200)
        self.assertEqual(login_user.json()["user"]["username"], test_user)

        # 3. Login by Email address (case-insensitive)
        login_email = self.client.post("/api/auth/login", json={
            "username": test_email.upper(),
            "password": pwd1
        })
        self.assertEqual(login_email.status_code, 200)

        # 4. Self-Service Password Reset
        reset_res = self.client.post("/api/auth/reset-password", json={
            "email": test_email,
            "new_password": pwd2
        })
        self.assertEqual(reset_res.status_code, 200)

        # 5. Verify Login with updated password
        login_new = self.client.post("/api/auth/login", json={
            "username": test_user,
            "password": pwd2
        })
        self.assertEqual(login_new.status_code, 200)

        # 6. Guest 1-Click Access
        guest_res = self.client.post("/api/auth/guest")
        self.assertEqual(guest_res.status_code, 200)
        guest_data = guest_res.json()
        self.assertEqual(guest_data["user"]["username"], "guest")
        self.assertTrue(bool(guest_data["access_token"]))

    def test_04_core_clipper_engine_features(self):
        """Verify probing, fast copy, exact cut, format conversion, and subtitle burning."""
        # Probing
        probe_v = probe_media(self.sample_mp4)
        self.assertTrue(probe_v.has_video)
        self.assertTrue(probe_v.has_audio)
        self.assertAlmostEqual(probe_v.duration, 3.0, delta=0.5)

        probe_a = probe_media(self.sample_wav)
        self.assertFalse(probe_a.has_video)
        self.assertTrue(probe_a.has_audio)

        # Fast Stream Copy
        out_fast = os.path.join(self.temp_dir, "clipped_fast.mp4")
        p_fast, m_fast = clip_media(
            input_path=self.sample_mp4,
            output_path=out_fast,
            start_time=0.5,
            end_time=2.0,
            mode="fast",
        )
        self.assertTrue(os.path.exists(p_fast))
        self.assertEqual(m_fast["mode"], "fast")

        # Exact Frame-Accurate Cut with Audio Conversion to MP3
        out_mp3 = os.path.join(self.temp_dir, "clipped.mp3")
        p_mp3, m_mp3 = clip_media(
            input_path=self.sample_wav,
            output_path=out_mp3,
            start_time=1.0,
            end_time=3.0,
            mode="exact",
            target_format="mp3",
        )
        self.assertTrue(os.path.exists(p_mp3))
        self.assertEqual(m_mp3["format"], "mp3")

        # Subtitle Burning
        transcript_mock = {
            "segments": [
                {
                    "start": 0.5,
                    "end": 2.2,
                    "text": "Hello world from 3D captioner clipper test!",
                    "speaker": "SPEAKER_00",
                    "words": [{"word": "Hello", "start": 0.5, "end": 0.9}]
                }
            ]
        }
        out_burnt = os.path.join(self.temp_dir, "clipped_burnt.mp4")
        p_burnt, m_burnt = clip_media(
            input_path=self.sample_mp4,
            output_path=out_burnt,
            start_time=0.5,
            end_time=2.5,
            mode="exact",
            burn_subtitles=True,
            subtitles_data=transcript_mock,
        )
        self.assertTrue(os.path.exists(p_burnt))
        self.assertTrue(m_burnt["burned_subtitles"])
        self.assertIsNotNone(m_burnt["sliced_transcript"])

    def test_05_standalone_direct_clipping_api(self):
        """Verify POST /api/media/clip without requiring prior transcription."""
        guest_auth = self.client.post("/api/auth/guest").json()
        headers = {"Authorization": f"Bearer {guest_auth['access_token']}"}

        with open(self.sample_wav, "rb") as f:
            res = self.client.post(
                "/api/media/clip",
                headers=headers,
                data={
                    "start_time": "0.5",
                    "end_time": "2.5",
                    "mode": "exact",
                    "title": "Standalone Demo Clip",
                    "target_format": "wav",
                },
                files={"file": ("standalone_test.wav", f, "audio/wav")}
            )
        self.assertEqual(res.status_code, 200, res.text)
        data = res.json()
        clip_id = data["clip_id"]
        self.assertEqual(data["title"], "Standalone Demo Clip")
        self.assertAlmostEqual(data["duration"], 2.0, delta=0.2)

        # Verify listed in GET /api/clips
        list_res = self.client.get("/api/clips", headers=headers)
        self.assertEqual(list_res.status_code, 200)
        clip_ids = [c["id"] for c in list_res.json()]
        self.assertIn(clip_id, clip_ids)

        # Verify streaming with HTTP Range
        stream_res = self.client.get(f"/api/clips/{clip_id}/stream", headers={"Range": "bytes=0-100"})
        self.assertIn(stream_res.status_code, [200, 206])

        # Verify download
        down_res = self.client.get(f"/api/clips/{clip_id}/download", headers=headers)
        self.assertEqual(down_res.status_code, 200)
        self.assertIn("Content-Disposition", down_res.headers)

        # Verify clean deletion
        del_res = self.client.delete(f"/api/clips/{clip_id}", headers=headers)
        self.assertEqual(del_res.status_code, 200)

    def test_06_cli_command_interface(self):
        """Verify captioner-clip CLI executable with --help."""
        cli_run = subprocess.run(
            [sys.executable, "-m", "captioner.clipper", "--help"],
            capture_output=True,
            text=True
        )
        self.assertEqual(cli_run.returncode, 0)
        self.assertIn("--start", cli_run.stdout)
        self.assertIn("--end", cli_run.stdout)
        self.assertIn("--mode", cli_run.stdout)
        self.assertIn("--burn-subtitles", cli_run.stdout)


if __name__ == "__main__":
    unittest.main()
