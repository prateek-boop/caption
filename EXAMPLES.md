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
