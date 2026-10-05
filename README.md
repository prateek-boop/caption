# Captioner

> High-performance automatic speech recognition, word-level phoneme alignment, and speaker diarization studio.

Captioner is an accelerated speech-to-text pipeline that provides real-time transcription with millisecond word-level timestamps and speaker diarization.

- ⚡️ **Batched Inference**: Up to 70x real-time transcription using faster-whisper (CTranslate2).
- 🎯 **Accurate Word-Level Timestamps**: Forced phoneme alignment using wav2vec2 CTC acoustic emissions.
- 👯‍♂️ **Speaker Diarization**: Multi-speaker labeling and attribution powered by Pyannote Audio.
- 🗣️ **VAD Preprocessing**: Voice Activity Detection strips silence and prevents hallucinations.
- 🎙️ **Interactive Web Studio**: Full-stack web application with user authentication, SQLite database, audio waveform playback, real-time word karaoke highlighting, and subtitle export (SRT, VTT, JSON, TXT, TSV).

---

## Web Studio UI

Captioner includes a full-featured web interface:

```bash
./start_studio.sh
```

Or run via Python:
```bash
python run_studio.py
```

The Web Studio is available at:
- **Web UI**: `http://localhost:8080`
- **Interactive API Documentation (Swagger)**: `http://localhost:8080/docs`

### Features
1. **User Authentication**: Secure user registration, login, and JWT session persistence.
2. **Interactive Upload Studio**: Drag-and-drop audio/video files, preset buttons (Fast, Balanced, Ultra Accurate), model selector (`tiny`, `base`, `small`, `medium`, `large-v2`, `large-v3`), and parameter customization.
3. **Word-Level Karaoke Player**: Audio player synchronized with millisecond-precision word highlighting. Click any word to jump audio playback to that exact timestamp.
4. **Speaker Diarization & Editing**: Edit transcripts, reassign speakers, and save changes directly to the database.
5. **Multi-Format Exporters**: Download subtitles in `.srt`, `.vtt`, `.json`, `.txt`, and `.tsv`.

---

## Python API Usage

```python
import captioner
from captioner.diarize import DiarizationPipeline, assign_word_speakers

device = "cuda" # or "cpu"
audio_file = "sample.wav"
batch_size = 16
compute_type = "float16" # or "int8" for CPU

# 1. Transcribe with batched model
model = captioner.load_model("base", device=device, compute_type=compute_type)
audio = captioner.load_audio(audio_file)
result = model.transcribe(audio, batch_size=batch_size)

# 2. Align word-level timestamps
model_a, metadata = captioner.load_align_model(language_code=result["language"], device=device)
result = captioner.align(result["segments"], model_a, metadata, audio, device)

# 3. Speaker Diarization (Optional)
diarize_model = DiarizationPipeline(token="YOUR_HF_TOKEN", device=device)
diarize_segments = diarize_model(audio)
result = assign_word_speakers(diarize_segments, result)

print(result["segments"])
```

---

## Command Line Interface (CLI)

Run transcription from the terminal:

```bash
captioner path/to/audio.wav --model base
```

With word-level timestamps and speaker diarization:

```bash
captioner path/to/audio.wav --model large-v2 --diarize --hf_token YOUR_HF_TOKEN
```

For CPU inference:

```bash
captioner path/to/audio.wav --device cpu --compute_type int8
```

---

## Architecture

```mermaid
flowchart TD
    A["Audio Input"] --> B["Stage 1: Voice Activity Detection (VAD)"]
    B --> C["Stage 2: Batched Speech-to-Text (CTranslate2)"]
    C --> D["Stage 3: Forced Phoneme Alignment (wav2vec 2.0)"]
    D --> E{"Diarization Enabled?"}
    E -->|Yes| F["Stage 4: Pyannote Diarization & Interval Tree Match"]
    E -->|No| G["Subtitles / Captions (.srt, .vtt, .json, .txt)"]
    F --> G
```

---

## License

MIT License. Copyright (c) 2026, Captioner Team.
# caption
