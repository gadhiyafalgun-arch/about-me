"""Tests for Pyttsx3Synthesizer against a fake injected engine -- the real pyttsx3
package (and whatever OS-level speech engine it wraps) is never touched here."""

import os
from dataclasses import dataclass, field

from voice.pyttsx3_tts import Pyttsx3Synthesizer


@dataclass
class FakePyttsx3Engine:
    calls: list = field(default_factory=list)
    ran_and_waited: bool = False

    def setProperty(self, name, value):
        self.calls.append(("setProperty", name, value))

    def save_to_file(self, text, path):
        self.calls.append(("save_to_file", text, path))
        with open(path, "wb") as f:
            f.write(f"WAV:{text}".encode())

    def runAndWait(self):
        self.ran_and_waited = True


def test_synthesize_writes_via_engine_then_returns_the_produced_bytes():
    engine = FakePyttsx3Engine()
    synthesizer = Pyttsx3Synthesizer(engine=engine)

    result = synthesizer.synthesize("hello there")

    assert result == b"WAV:hello there"
    assert engine.ran_and_waited is True
    save_call = next(c for c in engine.calls if c[0] == "save_to_file")
    assert save_call[1] == "hello there"


def test_synthesize_cleans_up_its_temp_file():
    engine = FakePyttsx3Engine()
    synthesizer = Pyttsx3Synthesizer(engine=engine)

    synthesizer.synthesize("hello there")

    save_call = next(c for c in engine.calls if c[0] == "save_to_file")
    assert not os.path.exists(save_call[2])


def test_rate_is_applied_to_the_engine_even_when_injected():
    engine = FakePyttsx3Engine()
    Pyttsx3Synthesizer(engine=engine, rate=210)

    assert ("setProperty", "rate", 210) in engine.calls


def test_default_rate_is_applied_when_not_specified():
    engine = FakePyttsx3Engine()
    Pyttsx3Synthesizer(engine=engine)

    assert ("setProperty", "rate", 175) in engine.calls
