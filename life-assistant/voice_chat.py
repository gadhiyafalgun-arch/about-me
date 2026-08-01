"""Voice-chat CLI: mic in -> local Whisper STT -> brain -> local TTS -> speaker out.
Wraps the exact same brain/tools chat.py uses; voice is purely an I/O layer on top
(see voice/pipeline.py) -- no scheduling or nutrition logic lives here.

Fully local speech stack -- no STT/TTS API key or network call, only
ANTHROPIC_API_KEY for the brain itself.

Usage:
    ANTHROPIC_API_KEY=... python voice_chat.py [--db canvas.db] [--model claude-opus-5]
                                                [--whisper-model-size base] [--tts-rate 175]

Needs a real microphone/speaker and extra local dependencies not required by the
rest of the test suite:
    pip install sounddevice numpy faster-whisper pyttsx3
On Linux, pyttsx3 also needs the `espeak` system package installed.

Push-to-talk: press Enter to start recording, press Enter again to stop.
"""

from __future__ import annotations

import argparse

import numpy as np
import sounddevice as sd

from brain import SYSTEM_PROMPT, BrainContext, ClaudeBrain, build_nutrition_tools, build_scheduler_tools
from nutrition import NutritionEngine, NutritionStore
from scheduler import Canvas, SchedulingEngine
from voice import FasterWhisperTranscriber, Pyttsx3Synthesizer, VoicePipeline
from voice.audio_io import SAMPLE_RATE, samples_from_wav_bytes, wav_bytes_from_samples


def record_until_enter() -> bytes:
    input("Press Enter to start recording...")
    print("Recording -- press Enter to stop.")
    frames: list[np.ndarray] = []

    def callback(indata, frame_count, time_info, status):
        frames.append(indata.copy())

    with sd.InputStream(samplerate=SAMPLE_RATE, channels=1, dtype="int16", callback=callback):
        input()

    samples = np.concatenate(frames, axis=0).reshape(-1) if frames else np.zeros(0, dtype="int16")
    return wav_bytes_from_samples(samples, SAMPLE_RATE)


def play_audio(audio: bytes) -> None:
    samples, sample_rate = samples_from_wav_bytes(audio)
    sd.play(samples, sample_rate)
    sd.wait()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", default="canvas.db", help="Path to the canvas SQLite database.")
    parser.add_argument("--model", default=None, help="Override the Claude model (default: claude-sonnet-5).")
    parser.add_argument("--whisper-model-size", default="base", help="faster-whisper model size (default: base).")
    parser.add_argument("--tts-rate", type=int, default=175, help="pyttsx3 speech rate, words/min (default: 175).")
    args = parser.parse_args()

    scheduling_engine = SchedulingEngine(Canvas(args.db))
    nutrition_engine = NutritionEngine(NutritionStore(args.db), scheduling_engine)
    tools = build_scheduler_tools(scheduling_engine) + build_nutrition_tools(nutrition_engine)
    brain = ClaudeBrain(model=args.model) if args.model else ClaudeBrain()
    context = BrainContext(system_prompt=SYSTEM_PROMPT)

    print("Loading local speech models (first run downloads the whisper model -- can take a minute)...")
    transcriber = FasterWhisperTranscriber(model_size=args.whisper_model_size)
    synthesizer = Pyttsx3Synthesizer(rate=args.tts_rate)
    pipeline = VoicePipeline(transcriber, synthesizer, brain)

    print("Life assistant voice chat. Ctrl+C to quit.\n")
    while True:
        try:
            audio = record_until_enter()
        except (EOFError, KeyboardInterrupt):
            print()
            break

        result = pipeline.handle_utterance(audio, tools, context)

        heard = f'You said: "{result.transcript}"'
        if result.needed_clarification:
            heard += "  (low confidence)"
        print(heard)

        if result.brain_reply:
            for call in result.brain_reply.tool_calls:
                outcome = f"error: {call.error}" if call.error else f"-> {call.result}"
                print(f"  [tool] {call.name}({call.arguments}) {outcome}")

        print(f"Assistant: {result.reply_text}\n")
        play_audio(result.reply_audio)


if __name__ == "__main__":
    main()
