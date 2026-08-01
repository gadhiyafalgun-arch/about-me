from __future__ import annotations

import io
import wave

import numpy as np

SAMPLE_RATE = 16000
SAMPLE_WIDTH_BYTES = 2  # 16-bit PCM


def wav_bytes_from_samples(samples: np.ndarray, sample_rate: int = SAMPLE_RATE) -> bytes:
    """Encode mono 16-bit PCM samples as an in-memory WAV byte string -- no temp
    file needed here, unlike the STT/TTS adapters, which write one because their
    underlying libraries only accept a path."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(SAMPLE_WIDTH_BYTES)
        wf.setframerate(sample_rate)
        wf.writeframes(samples.astype(np.int16).tobytes())
    return buf.getvalue()


def samples_from_wav_bytes(audio: bytes) -> tuple[np.ndarray, int]:
    """Decode a WAV byte string back into 16-bit PCM samples and its sample rate.
    Multi-channel audio is reshaped to (frames, channels); mono stays 1-D."""
    with wave.open(io.BytesIO(audio), "rb") as wf:
        frames = wf.readframes(wf.getnframes())
        sample_rate = wf.getframerate()
        channels = wf.getnchannels()
    samples = np.frombuffer(frames, dtype=np.int16)
    if channels > 1:
        samples = samples.reshape(-1, channels)
    return samples, sample_rate
