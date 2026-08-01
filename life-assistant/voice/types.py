from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Protocol

from brain.types import BrainReply


@dataclass
class TranscriptionResult:
    """What a Transcriber produced for one utterance. `confidence` is a 0-1 estimate
    of how much the transcript should be trusted -- providers that don't expose a
    real confidence score should return 1.0 for clearly-heard audio and 0.0 for
    silence/no-speech, so VoicePipeline's clarification threshold still behaves
    sensibly regardless of provider."""

    text: str
    confidence: float = 1.0


class Transcriber(Protocol):
    """Speech-to-text: raw audio bytes in, best-effort transcript out. Implementations
    must not do any brain/tool logic -- they only convert audio to text."""

    def transcribe(self, audio: bytes) -> TranscriptionResult: ...


class Synthesizer(Protocol):
    """Text-to-speech: reply text in, audio bytes out. Implementations must not alter
    or interpret the text -- they only render it as speech."""

    def synthesize(self, text: str) -> bytes: ...


@dataclass
class VoiceTurnResult:
    """What one spoken turn produced end-to-end: the raw transcript, whatever was
    actually spoken back to the user, and -- only when the turn was clear enough to
    reach the brain -- its full reply (tool calls included)."""

    transcript: str
    confidence: float
    reply_text: str
    reply_audio: bytes
    needed_clarification: bool
    brain_reply: Optional[BrainReply] = None
