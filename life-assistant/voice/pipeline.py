from __future__ import annotations

from brain.types import BrainAdapter, BrainContext, Tool

from .types import Synthesizer, Transcriber, VoiceTurnResult

DEFAULT_CONFIDENCE_THRESHOLD = 0.4
DEFAULT_CLARIFICATION_MESSAGE = "Sorry, I didn't catch that -- could you say that again?"


class VoicePipeline:
    """Wraps a Transcriber and Synthesizer around an existing BrainAdapter, so voice
    is purely an I/O layer on top of the same brain/tools the text chat uses -- no
    scheduling or nutrition logic lives here.

    If the transcript is empty or below `confidence_threshold`, the turn never
    reaches the brain at all: a clarification request is spoken back and the turn
    stops there, so a misheard or silent utterance can't turn into a bogus tool
    call (e.g. a garbled "log_meal" for something the user never actually said)."""

    def __init__(
        self,
        transcriber: Transcriber,
        synthesizer: Synthesizer,
        brain: BrainAdapter,
        confidence_threshold: float = DEFAULT_CONFIDENCE_THRESHOLD,
        clarification_message: str = DEFAULT_CLARIFICATION_MESSAGE,
    ):
        self.transcriber = transcriber
        self.synthesizer = synthesizer
        self.brain = brain
        self.confidence_threshold = confidence_threshold
        self.clarification_message = clarification_message

    def handle_utterance(self, audio: bytes, tools: list[Tool], context: BrainContext) -> VoiceTurnResult:
        transcription = self.transcriber.transcribe(audio)

        if not transcription.text.strip() or transcription.confidence < self.confidence_threshold:
            reply_audio = self.synthesizer.synthesize(self.clarification_message)
            return VoiceTurnResult(
                transcript=transcription.text,
                confidence=transcription.confidence,
                reply_text=self.clarification_message,
                reply_audio=reply_audio,
                needed_clarification=True,
                brain_reply=None,
            )

        reply = self.brain.ask(transcription.text, tools, context)
        reply_audio = self.synthesizer.synthesize(reply.response_text)
        return VoiceTurnResult(
            transcript=transcription.text,
            confidence=transcription.confidence,
            reply_text=reply.response_text,
            reply_audio=reply_audio,
            needed_clarification=False,
            brain_reply=reply,
        )
