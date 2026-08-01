from __future__ import annotations

import os
import tempfile
from typing import Any, Optional

DEFAULT_RATE = 175


class Pyttsx3Synthesizer:
    """Local text-to-speech via pyttsx3 -- wraps the OS's own speech engine (SAPI5 on
    Windows, NSSpeechSynthesizer on macOS, espeak on Linux). No API key, no network
    call, no per-character cost. Loads a real engine on first use unless one is
    injected; tests always inject a fake engine, so pyttsx3 (and whatever OS-level
    speech engine it wraps) is never touched in the test suite -- the same
    lazy-import pattern used for FasterWhisperTranscriber and ClaudeBrain."""

    def __init__(self, engine: Optional[Any] = None, rate: int = DEFAULT_RATE):
        if engine is None:
            import pyttsx3

            engine = pyttsx3.init()
        engine.setProperty("rate", rate)
        self.engine = engine

    def synthesize(self, text: str) -> bytes:
        fd, path = tempfile.mkstemp(suffix=".wav")
        os.close(fd)
        try:
            self.engine.save_to_file(text, path)
            self.engine.runAndWait()
            with open(path, "rb") as f:
                return f.read()
        finally:
            os.remove(path)
