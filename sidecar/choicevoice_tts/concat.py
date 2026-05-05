"""Stitch a list of audio arrays into one WAV file."""
import numpy as np
import soundfile as sf

SAMPLE_RATE = 24000
SILENCE_FRAMES = int(SAMPLE_RATE * 0.15)  # 150 ms inter-chunk silence


def stitch(arrays: list[np.ndarray], out_path: str, sample_rate: int = SAMPLE_RATE) -> int:
    """Write arrays joined with silence to out_path. Returns total sample count."""
    silence = np.zeros(SILENCE_FRAMES, dtype=np.float32)
    parts = []
    for i, arr in enumerate(arrays):
        arr = np.asarray(arr, dtype=np.float32)
        if arr.ndim > 1:
            arr = arr.mean(axis=-1)
        arr = arr.squeeze()
        parts.append(arr)
        if i < len(arrays) - 1:
            parts.append(silence)

    combined = np.concatenate(parts) if parts else np.zeros(0, dtype=np.float32)
    # Normalise to prevent clipping
    peak = np.max(np.abs(combined))
    if peak > 1.0:
        combined = combined / peak

    sf.write(out_path, combined, sample_rate, subtype="PCM_16")
    return len(combined)
