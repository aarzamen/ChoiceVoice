"""TTS engine: mlx-audio primary, qwen_tts PyTorch/MPS fallback.

Module-level singleton — load once, generate many times.
"""
import contextlib
import os
import sys
import numpy as np


@contextlib.contextmanager
def _stdout_to_stderr():
    """Redirect stdout to stderr so library chatter doesn't corrupt JSONL output."""
    old_stdout = sys.stdout
    sys.stdout = sys.stderr
    # Also redirect C-level stdout (for tqdm and other native extensions)
    old_fd = os.dup(1)
    try:
        os.dup2(sys.stderr.fileno(), 1)
    except Exception:
        old_fd = None
    try:
        yield
    finally:
        sys.stdout = old_stdout
        if old_fd is not None:
            try:
                os.dup2(old_fd, 1)
                os.close(old_fd)
            except Exception:
                pass

# ──────────────────────────────────────────────────────────────
# Supported backends
# ──────────────────────────────────────────────────────────────
BACKEND_MLX = "mlx"
BACKEND_TORCH = "torch_mps"

MLX_MODEL_ID   = "mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit"
TORCH_MODEL_ID = "Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice"

SAMPLE_RATE = 24000

# ──────────────────────────────────────────────────────────────
# Singleton state
# ──────────────────────────────────────────────────────────────
_backend: str | None = None
_model = None           # mlx_audio model OR Qwen3TTSModel
_processor = None       # only for torch path


def _try_mlx(model_id: str):
    """Return (model, BACKEND_MLX) or raise."""
    from mlx_audio.tts.utils import load_model
    model = load_model(model_id)
    return model, BACKEND_MLX


def _try_torch(model_id: str):
    """Return (model, processor, BACKEND_TORCH) or raise."""
    import torch
    from transformers import AutoConfig
    # Try to import the Alibaba qwen_tts wrapper; fall back to raw transformers.
    try:
        import importlib.util, os
        # Look for the package in the same repo directory
        repo = os.path.join(os.path.dirname(__file__), "..", "..", "..", "Qwen3-TTS-main")
        spec = importlib.util.spec_from_file_location(
            "qwen_tts",
            os.path.join(repo, "qwen_tts", "__init__.py"),
            submodule_search_locations=[os.path.join(repo, "qwen_tts")],
        )
        if spec is None:
            raise ImportError("qwen_tts not found at expected path")
        from qwen_tts.inference.qwen3_tts_model import Qwen3TTSModel
        from transformers import AutoModel, AutoProcessor
        _cfg = AutoConfig.from_pretrained(model_id, trust_remote_code=True)
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        raw_model = AutoModel.from_pretrained(
            model_id,
            config=_cfg,
            torch_dtype=torch.bfloat16,
            trust_remote_code=True,
        ).to(device)
        processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
        model = Qwen3TTSModel(raw_model, processor)
        return model, processor, BACKEND_TORCH
    except Exception:
        pass

    # Final fallback: raw transformers (no qwen_tts wrapper)
    from transformers import AutoModel, AutoProcessor
    import torch
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    raw_model = AutoModel.from_pretrained(
        model_id,
        torch_dtype=torch.bfloat16,
        trust_remote_code=True,
    ).to(device)
    processor = AutoProcessor.from_pretrained(model_id, trust_remote_code=True)
    return (raw_model, processor), processor, BACKEND_TORCH


def load(
    model_size: str = "1.7B",
    force_backend: str | None = None,
    emit=None,
) -> str:
    """Load model into singleton. Returns backend name."""
    global _backend, _model, _processor

    if _model is not None:
        return _backend

    mlx_id = MLX_MODEL_ID.replace("1.7B", model_size) if model_size != "1.7B" else MLX_MODEL_ID
    torch_id = TORCH_MODEL_ID.replace("1.7B", model_size) if model_size != "1.7B" else TORCH_MODEL_ID

    if force_backend != BACKEND_TORCH:
        if emit:
            emit({"event": "loading_model", "model": mlx_id, "backend": BACKEND_MLX})
        try:
            with _stdout_to_stderr():
                _model, _backend = _try_mlx(mlx_id)
            return _backend
        except Exception as e:
            print(
                f'{{"event":"warning","message":"mlx-audio failed, falling back to torch"}}',
                flush=True,
            )
            print(f"mlx-audio error: {e}", file=sys.stderr)

    if emit:
        emit({"event": "loading_model", "model": torch_id, "backend": BACKEND_TORCH})
    with _stdout_to_stderr():
        _model, _processor, _backend = _try_torch(torch_id)
    return _backend


def generate(
    text: str,
    speaker: str,
    language: str = "Auto",
    style: str | None = None,
) -> np.ndarray:
    """Generate audio for one chunk. Returns float32 numpy array at 24kHz."""
    if _model is None:
        raise RuntimeError("call engine.load() first")

    if _backend == BACKEND_MLX:
        return _generate_mlx(text, speaker, language, style)
    else:
        return _generate_torch(text, speaker, language, style)


# ──────────────────────────────────────────────────────────────
# MLX path
# ──────────────────────────────────────────────────────────────

def _generate_mlx(text: str, speaker: str, language: str, style: str | None) -> np.ndarray:
    import mlx.core as mx

    prompt = text
    # Style conditioning: mlx-audio Qwen3 has no explicit param — embed in voice label
    voice = speaker
    if style:
        voice = f"{speaker} ({style})"

    results = list(_model.generate(
        text=prompt,
        voice=voice,
        temperature=0.6,
        top_p=0.9,
        max_tokens=2048,
        verbose=False,
    ))
    if not results:
        raise RuntimeError("mlx-audio returned no audio")

    # Concatenate all segments (model may split on newlines internally)
    arrays = []
    for r in results:
        arr = np.array(r.audio, dtype=np.float32)
        arrays.append(arr.squeeze())
    return np.concatenate(arrays) if len(arrays) > 1 else arrays[0]


# ──────────────────────────────────────────────────────────────
# PyTorch / MPS path (official Qwen3-TTS CustomVoice API)
# ──────────────────────────────────────────────────────────────

def _generate_torch(text: str, speaker: str, language: str, style: str | None) -> np.ndarray:
    # _model may be a Qwen3TTSModel wrapper or a raw (model, processor) tuple
    import torch

    lang_map = {
        "Auto": None,
        "English": "en",
        "Chinese": "zh",
        "Japanese": "ja",
        "Korean": "ko",
    }
    lang_code = lang_map.get(language)

    if hasattr(_model, "generate_custom_voice"):
        wavs, sr = _model.generate_custom_voice(
            text=[text],
            speaker=speaker,
            language=lang_code,
            style_instruction=style or "",
        )
        return np.asarray(wavs[0], dtype=np.float32)

    # Raw model path — use processor directly
    raw_model, processor = _model
    inputs = processor(
        text=text,
        speaker=speaker,
        return_tensors="pt",
    )
    device = next(raw_model.parameters()).device
    inputs = {k: v.to(device) for k, v in inputs.items()}

    with torch.no_grad():
        output = raw_model.generate(**inputs, max_new_tokens=4096)

    wav = output.cpu().float().numpy().squeeze()
    return wav
