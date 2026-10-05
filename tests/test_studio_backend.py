import os
import sys
import io

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if REPO_ROOT not in sys.path:
    sys.path.insert(0, REPO_ROOT)

import wave
import struct
import math
from fastapi.testclient import TestClient
from web.server import app

client = TestClient(app)

def create_dummy_wav(duration_secs=1.5, sample_rate=16000):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as wav_file:
        wav_file.setnchannels(1) # mono
        wav_file.setsampwidth(2) # 16-bit
        wav_file.setframerate(sample_rate)
        # generate a gentle 440 Hz tone
        num_samples = int(duration_secs * sample_rate)
        data = bytearray()
        for i in range(num_samples):
            val = int(32767.0 * 0.3 * math.sin(2.0 * math.pi * 440.0 * i / sample_rate))
            data.extend(struct.pack('<h', val))
        wav_file.writeframes(data)
    buf.seek(0)
    return buf

def test_full_studio_workflow():
    print("\n--- 1. Testing Registration ---")
    reg_payload = {
        "username": "testuser",
        "email": "test@example.com",
        "password": "securepassword123"
    }
    res = client.post("/api/auth/register", json=reg_payload)
    if res.status_code == 400: # Already registered in previous test
        print("User already exists, proceeding to login...")
    else:
        assert res.status_code == 200, f"Register failed: {res.text}"
        print("Registration successful!")

    print("\n--- 2. Testing Login ---")
    login_payload = {
        "username": "testuser",
        "password": "securepassword123"
    }
    res = client.post("/api/auth/login", json=login_payload)
    assert res.status_code == 200, f"Login failed: {res.text}"
    token_data = res.json()
    token = token_data["access_token"]
    assert token, "Token missing"
    headers = {"Authorization": f"Bearer {token}"}
    print(f"Login successful! Received JWT token: {token[:20]}...")

    print("\n--- 3. Testing /api/auth/me ---")
    res = client.get("/api/auth/me", headers=headers)
    assert res.status_code == 200, res.text
    user_me = res.json()
    assert user_me["username"] == "testuser"
    print(f"User profile retrieved: {user_me}")

    print("\n--- 4. Testing /api/system/info ---")
    res = client.get("/api/system/info")
    assert res.status_code == 200, res.text
    sys_info = res.json()
    print(f"System info: CUDA Available={sys_info['cuda_available']}, Default={sys_info['default_device']}")

    print("\n--- 5. Testing /api/auth/settings ---")
    settings_payload = {
        "default_hf_token": "hf_testdummytoken12345",
        "default_model": "base",
        "default_device": "cpu",
        "default_compute_type": "int8"
    }
    res = client.put("/api/auth/settings", json=settings_payload, headers=headers)
    assert res.status_code == 200, res.text
    print("User settings saved successfully!")

    print("\n--- 6. Testing Audio Upload & Job Creation ---")
    dummy_wav = create_dummy_wav(1.0)
    files = {"file": ("test_tone.wav", dummy_wav, "audio/wav")}
    data = {
        "title": "Automated Test Audio",
        "model_size": "tiny",
        "device": "cpu",
        "compute_type": "int8",
        "batch_size": "4",
        "align": "false",
        "diarize": "false"
    }
    res = client.post("/api/transcribe/upload", files=files, data=data, headers=headers)
    assert res.status_code == 200, f"Upload failed: {res.text}"
    job_resp = res.json()
    job_id = job_resp["job_id"]
    print(f"Job created successfully! Job ID: {job_id}")

    print("\n--- 7. Testing /api/jobs list ---")
    res = client.get("/api/jobs", headers=headers)
    assert res.status_code == 200, res.text
    jobs = res.json()
    assert len(jobs) > 0, "No jobs listed"
    print(f"Found {len(jobs)} jobs in database.")

    print("\n--- 8. Testing /api/jobs/{job_id} ---")
    res = client.get(f"/api/jobs/{job_id}", headers=headers)
    assert res.status_code == 200, res.text
    job_detail = res.json()
    assert job_detail["id"] == job_id
    print(f"Job {job_id} status: {job_detail['status']}")

    print("\n--- 9. Testing Segments Update & Exporters ---")
    dummy_segments = [
        {
            "start": 0.0,
            "end": 1.0,
            "text": "Hello world from Captioner test!",
            "speaker": "SPEAKER_00",
            "words": [
                {"word": "Hello", "start": 0.0, "end": 0.3},
                {"word": "world", "start": 0.3, "end": 0.6},
                {"word": "from", "start": 0.6, "end": 0.8},
                {"word": "Captioner", "start": 0.8, "end": 1.0}
            ]
        }
    ]
    # Inject result_data directly to verify exporters
    from web.database import SessionLocal, TranscriptionJob
    db = SessionLocal()
    j = db.query(TranscriptionJob).filter(TranscriptionJob.id == job_id).first()
    j.result_data = {"segments": dummy_segments, "language": "en"}
    db.commit()
    db.close()

    for fmt in ["srt", "vtt", "txt", "tsv", "json"]:
        exp_res = client.get(f"/api/jobs/{job_id}/export/{fmt}", headers=headers)
        assert exp_res.status_code == 200, f"Export {fmt} failed"
        print(f"Export format {fmt.upper()} generated successfully ({len(exp_res.content)} bytes)!")

    print("\n--- 10. Testing Static Index Serving ---")
    res = client.get("/")
    assert res.status_code == 200
    assert "Captioner Studio" in res.text
    print("Static Single Page App served successfully!")

    print("\n>>> ALL TESTS PASSED SUCCESSFULLY! <<<")

if __name__ == "__main__":
    test_full_studio_workflow()
