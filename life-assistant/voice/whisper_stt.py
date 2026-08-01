from __future__ import annotations

import os
import tempfile
from typing import Any, Optional

from .types import TranscriptionResult

DEFAULT_MODEL_SIZE = "base"
DEFAULT_DEVICE = "cpu"
DEFAULT_COMPUTE_TYPE = "int8"


class FasterWhisperTranscriber:
    """Local speech-to-text via faster-whisper -- no API key, no network call, no
    per-utterance cost. Loads a real model on first use unless one is injected;
    tests always inject a fake model object, so the (heavy) faster_whisper package
    is never imported or loaded in the test suite -- the same lazy-import pattern
    ClaudeBrain uses for the `anthropic` package."""

    def __init__(
        self,
        model: Optional[Any] = None,
        model_size: str = DEFAULT_MODEL_SIZE,
        device: str = DEFAULT_DEVICE,
        compute_type: str = DEFAULT_COMPUTE_TYPE,
    ):
        if model is None:
            from faster_whisper import WhisperModel

            model = WhisperModel(model_size, device=device, compute_type=compute_type)
        self.model = model

    def transcribe(self, audio: bytes) -> TranscriptionResult:
        fd, path = tempfile.mkstemp(suffix=".wav")
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(audio)
            segments = list(self.model.transcribe(path)[0])
        finally:
            os.remove(path)

        if not segments:
            return TranscriptionResult(text="", confidence=0.0)

        text = "".join(segment.text for segment in segments).strip()
        # faster-whisper reports `no_speech_prob` per segment (0 = definitely
        # speech, 1 = definitely silence/noise) -- invert and average into a 0-1
        # confidence so VoicePipeline's clarification threshold works the same
        # way regardless of which Transcriber is plugged in.
        avg_no_speech = sum(getattr(segment, "no_speech_prob", 0.0) for segment in segments) / len(segments)
        confidence = max(0.0, min(1.0, 1.0 - avg_no_speech))
        return TranscriptionResult(text=text, confidence=confidence)
