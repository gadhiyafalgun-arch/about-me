"""Tests for VoicePipeline using fake Transcriber/Synthesizer/Brain -- no real audio
model, TTS engine, or network call involved. These verify the *pipeline mechanics*
(clarification threshold, brain/synthesizer wiring), never real STT/TTS quality."""

from dataclasses import dataclass, field

from brain.types import BrainContext, BrainReply, Tool
from voice.pipeline import DEFAULT_CLARIFICATION_MESSAGE, VoicePipeline
from voice.types import TranscriptionResult


@dataclass
class FakeTranscriber:
    result: TranscriptionResult
    calls: list = field(default_factory=list)

    def transcribe(self, audio: bytes) -> TranscriptionResult:
        self.calls.append(audio)
        return self.result


@dataclass
class FakeSynthesizer:
    calls: list = field(default_factory=list)

    def synthesize(self, text: str) -> bytes:
        self.calls.append(text)
        return f"AUDIO:{text}".encode()


@dataclass
class FakeBrain:
    reply_text: str = "Sure thing."
    calls: list = field(default_factory=list)

    def ask(self, user_message: str, available_tools: list[Tool], context: BrainContext) -> BrainReply:
        self.calls.append({"user_message": user_message, "tools": available_tools, "context": context})
        return BrainReply(response_text=self.reply_text, tool_calls=[])


def test_low_confidence_transcript_triggers_clarification_without_calling_brain():
    transcriber = FakeTranscriber(TranscriptionResult(text="mumble mumble", confidence=0.1))
    synthesizer = FakeSynthesizer()
    brain = FakeBrain()
    pipeline = VoicePipeline(transcriber, synthesizer, brain)

    result = pipeline.handle_utterance(b"raw-audio", [], BrainContext(system_prompt="sys"))

    assert result.needed_clarification is True
    assert result.reply_text == DEFAULT_CLARIFICATION_MESSAGE
    assert result.brain_reply is None
    assert brain.calls == []  # never reached the brain -- no bogus tool calls possible
    assert synthesizer.calls == [DEFAULT_CLARIFICATION_MESSAGE]
    assert result.reply_audio == f"AUDIO:{DEFAULT_CLARIFICATION_MESSAGE}".encode()


def test_empty_transcript_triggers_clarification_even_with_high_confidence():
    # Whitespace-only text must not reach the brain regardless of the confidence
    # score a provider happens to report.
    transcriber = FakeTranscriber(TranscriptionResult(text="   ", confidence=1.0))
    brain = FakeBrain()
    pipeline = VoicePipeline(transcriber, FakeSynthesizer(), brain)

    result = pipeline.handle_utterance(b"raw-audio", [], BrainContext(system_prompt="sys"))

    assert result.needed_clarification is True
    assert brain.calls == []


def test_confident_transcript_flows_through_to_brain_and_synthesizer():
    transcriber = FakeTranscriber(TranscriptionResult(text="what's on my schedule today?", confidence=0.92))
    synthesizer = FakeSynthesizer()
    brain = FakeBrain(reply_text="You've got a 2pm meeting and nothing else.")
    pipeline = VoicePipeline(transcriber, synthesizer, brain)
    context = BrainContext(system_prompt="sys")

    result = pipeline.handle_utterance(b"raw-audio", [], context)

    assert result.needed_clarification is False
    assert brain.calls == [{"user_message": "what's on my schedule today?", "tools": [], "context": context}]
    assert result.reply_text == "You've got a 2pm meeting and nothing else."
    assert result.brain_reply.response_text == "You've got a 2pm meeting and nothing else."
    assert synthesizer.calls == ["You've got a 2pm meeting and nothing else."]
    assert result.reply_audio == b"AUDIO:You've got a 2pm meeting and nothing else."


def test_confidence_threshold_is_configurable():
    # A transcript that would pass the default threshold (0.4) must still trigger
    # clarification once the pipeline is configured to be stricter.
    transcriber = FakeTranscriber(TranscriptionResult(text="book a meeting", confidence=0.75))
    brain = FakeBrain()
    pipeline = VoicePipeline(transcriber, FakeSynthesizer(), brain, confidence_threshold=0.8)

    result = pipeline.handle_utterance(b"raw-audio", [], BrainContext(system_prompt="sys"))

    assert result.needed_clarification is True
    assert brain.calls == []


def test_clarification_message_is_configurable():
    transcriber = FakeTranscriber(TranscriptionResult(text="", confidence=0.0))
    pipeline = VoicePipeline(
        transcriber, FakeSynthesizer(), FakeBrain(), clarification_message="Come again?"
    )

    result = pipeline.handle_utterance(b"raw-audio", [], BrainContext(system_prompt="sys"))

    assert result.reply_text == "Come again?"
