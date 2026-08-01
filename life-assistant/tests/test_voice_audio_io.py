"""Tests for the WAV encode/decode helpers used to bridge recorded mic samples and
the STT/TTS adapters -- pure functions, no sounddevice/hardware involved."""

import numpy as np

from voice.audio_io import samples_from_wav_bytes, wav_bytes_from_samples


def test_round_trip_preserves_samples_and_sample_rate():
    samples = np.array([0, 100, -100, 32767, -32768], dtype=np.int16)

    encoded = wav_bytes_from_samples(samples, sample_rate=16000)
    decoded, rate = samples_from_wav_bytes(encoded)

    assert rate == 16000
    assert np.array_equal(decoded, samples)


def test_round_trip_with_a_different_sample_rate():
    samples = np.array([1, 2, 3, 4], dtype=np.int16)

    encoded = wav_bytes_from_samples(samples, sample_rate=44100)
    decoded, rate = samples_from_wav_bytes(encoded)

    assert rate == 44100
    assert np.array_equal(decoded, samples)


def test_encoded_bytes_have_a_valid_wav_header():
    samples = np.array([1, 2, 3], dtype=np.int16)

    encoded = wav_bytes_from_samples(samples)

    assert encoded[:4] == b"RIFF"
    assert encoded[8:12] == b"WAVE"


def test_default_sample_rate_matches_whisper_expectation():
    samples = np.array([1, 2, 3], dtype=np.int16)

    encoded = wav_bytes_from_samples(samples)
    _decoded, rate = samples_from_wav_bytes(encoded)

    assert rate == 16000
