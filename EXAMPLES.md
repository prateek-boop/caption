# Captioner Examples

## Multilingual Transcription & Alignment

For non-English speech, use the `large-v2` or `large-v3` model. Alignment models are automatically selected based on the detected or specified language.

Currently tested languages include English, French, German, Spanish, Italian, Japanese, Chinese, Dutch, Portuguese, Arabic, Russian, Hindi, and more.

### French
```bash
captioner --model large-v2 --language fr audio_fr.wav
```

### German
```bash
captioner --model large-v2 --language de audio_de.wav
```

### Spanish
```bash
captioner --model large-v2 --language es audio_es.wav
```

### Japanese
```bash
captioner --model large-v2 --language ja audio_ja.wav
```

---

## Media Clipping Examples

### Extract 30-second audio snippet as MP3
```bash
captioner-clip lecture.wav -s 00:05:00 -d 30 -f mp3 -o lecture_snippet.mp3
```

### Frame-accurate video clipping with burnt subtitles
```bash
captioner-clip podcast.mp4 -s 00:02:15.5 -e 00:03:45.0 --burn-subtitles --subtitles podcast.srt -o clip_subbed.mp4
```

---

## Docker Execution Examples

### Run the full studio with Docker Compose
```bash
docker compose up --build -d
```

### Run with the automated bash runner
```bash
./run_docker.sh
```

### Run using raw Docker CLI
```bash
docker build -t captioner-studio .
docker run -d -p 8080:8080 -v $(pwd)/web/data:/app/web/data --name captioner-studio captioner-studio
```
