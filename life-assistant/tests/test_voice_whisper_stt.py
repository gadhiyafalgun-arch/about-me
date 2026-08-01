"""Tests for FasterWhisperTranscriber against a fake injected model -- the real
faster_whisper package is never imported or loaded here, so these run with no model
download and no real audio decoding."""

import os
from dataclasses import dataclass, field

from voice.whisper_stt import FasterWhisperTranscriber


@dataclass
class FakeSegment:
    text: str
    no_speech_prob: float = 0.0


@dataclass
class FakeWhisperModel:
    segments: list
    calls: list = field(default_factory=list)
    received_bytes: bytes = b""

    def transcribe(self, path, **kwargs):
        with open(path, "rb") as f:
            self.received_bytes = f.read()
        self.calls.append(path)
        return iter(self.segments), object()


def test_transcribe_writes_audio_bytes_to_a_temp_file_and_cleans_up():
    model = FakeWhisperModel(segments=[FakeSegment(text="hello")])
    transcriber = FasterWhisperTranscriber(model=model)

    transcriber.transcribe(b"raw-wav-bytes")

    assert model.received_bytes == b"raw-wav-bytes"
    assert len(model.calls) == 1
    assert not os.path.exists(model.calls[0])  # temp file removed after use


def test_transcribe_joins_multiple_segments_and_strips_whitespace():
    model = FakeWhisperModel(segments=[FakeSegment(text=" Hello"), FakeSegment(text=" world.")])
    transcriber = FasterWhisperTranscriber(model=model)

    result = transcriber.transcribe(b"raw-wav-bytes")

    assert result.text == "Hello world."


def test_transcribe_reports_high_confidence_for_clear_speech():
    model = FakeWhisperModel(segments=[FakeSegment(text="book a meeting", no_speech_prob=0.02)])
    transcriber = FasterWhisperTranscriber(model=model)

    result = transcriber.transcribe(b"raw-wav-bytes")

    assert result.confidence > 0.9


def test_transcribe_reports_low_confidence_for_likely_silence_or_noise():
    model = FakeWhisperModel(segments=[FakeSegment(text="uh", no_speech_prob=0.85)])
    transcriber = FasterWhisperTranscriber(model=model)

    result = transcriber.transcribe(b"raw-wav-bytes")

    assert result.confidence < 0.2


def test_transcribe_returns_empty_result_for_no_segments():
    model = FakeWhisperModel(segments=[])
    transcriber = FasterWhisperTranscriber(model=model)

    result = transcriber.transcribe(b"silence")

    assert result.text == ""
    assert result.confidence == 0.0
