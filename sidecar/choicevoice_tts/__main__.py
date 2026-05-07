"""choicevoice-tts CLI — JSON-over-stdio sidecar for Tauri.

Usage:
  echo '{"text":"Hello.","style":"cheerfully"}' \\
    | python -m choicevoice_tts \\
        --job-id <uuid> --speaker Ryan --language English \\
        --model-size 1.7B --output /tmp/out.wav
"""
import argparse
import json
import sys
import time
import traceback

from . import chunker as _chunker
from . import engine as _engine
from . import concat as _concat


def emit(obj: dict) -> None:
    print(json.dumps(obj), flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(prog="choicevoice-tts")
    parser.add_argument("--job-id",     required=True)
    parser.add_argument("--speaker",    default="Ryan")
    parser.add_argument("--language",   default="Auto")
    parser.add_argument("--model-size", default="1.7B", dest="model_size")
    parser.add_argument("--output",     required=True)
    parser.add_argument("--backend",    default=None,
                        help="Force backend: mlx or torch_mps")
    args = parser.parse_args()

    # Read text (and optional style) from stdin — one JSON line
    raw = sys.stdin.readline()
    try:
        payload = json.loads(raw)
        text  = payload.get("text", "")
        style = payload.get("style") or None
    except json.JSONDecodeError:
        text  = raw
        style = None

    if not text.strip():
        emit({"event": "error", "stage": "input", "message": "Empty text"})
        sys.exit(1)

    t_start = time.time()

    # ── Load model ────────────────────────────────────────────
    try:
        backend = _engine.load(
            model_size=args.model_size,
            force_backend=args.backend,
            emit=emit,
        )
        emit({"event": "model_loaded", "backend": backend,
              "load_ms": int((time.time() - t_start) * 1000)})
    except Exception as exc:
        emit({"event": "error", "stage": "model_load", "message": str(exc)})
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)

    # ── Chunk text ────────────────────────────────────────────
    chunks = _chunker.chunk_text(text)
    if not chunks:
        emit({"event": "error", "stage": "chunking", "message": "No chunks produced"})
        sys.exit(1)

    emit({"event": "chunked", "total": len(chunks)})

    # ── Generate per chunk ────────────────────────────────────
    arrays = []
    for i, chunk in enumerate(chunks):
        try:
            arr = _engine.generate(
                text=chunk,
                speaker=args.speaker,
                language=args.language,
                style=style,
            )
            arrays.append(arr)
            emit({"event": "chunk_done", "i": i + 1, "of": len(chunks),
                  "samples": len(arr)})
        except Exception as exc:
            emit({"event": "error", "stage": "chunk", "i": i + 1,
                  "message": str(exc)})
            traceback.print_exc(file=sys.stderr)
            # Retry with smaller chunk (OOM fallback from spec §10)
            if "memory" in str(exc).lower() or "oom" in str(exc).lower():
                emit({"event": "degraded_chunking"})
                sub = _chunker.chunk_text(chunk, max_words=60)
                for j, sub_chunk in enumerate(sub):
                    try:
                        arr = _engine.generate(
                            text=sub_chunk,
                            speaker=args.speaker,
                            language=args.language,
                            style=style,
                        )
                        arrays.append(arr)
                    except Exception as sub_exc:
                        emit({"event": "error", "stage": "chunk_retry",
                              "i": i + 1, "sub": j + 1,
                              "message": str(sub_exc)})
                        sys.exit(1)
            else:
                sys.exit(1)

    # ── Stitch and write WAV ──────────────────────────────────
    try:
        total_samples = _concat.stitch(arrays, args.output)
    except PermissionError:
        import os
        fallback = os.path.expanduser(
            f"~/Documents/ChoiceVoice/{args.job_id}.wav"
        )
        os.makedirs(os.path.dirname(fallback), exist_ok=True)
        emit({"event": "warning",
              "message": f"Permission denied writing to {args.output}; using {fallback}"})
        total_samples = _concat.stitch(arrays, fallback)
        args.output = fallback

    duration_s = total_samples / _concat.SAMPLE_RATE

    # Write sidecar metadata JSON
    import datetime
    meta = {
        "job_id":       args.job_id,
        "created_at":   datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
        "speaker":      args.speaker,
        "language":     args.language,
        "style":        style,
        "model_size":   args.model_size,
        "text_preview": text[:200],
        "duration_s":   round(duration_s, 3),
        "sample_rate":  _concat.SAMPLE_RATE,
    }
    with open(args.output + ".json", "w") as fh:
        import json as _json
        _json.dump(meta, fh, indent=2)

    emit({
        "event":     "complete",
        "wav_path":  args.output,
        "duration_s": round(duration_s, 3),
        "sample_rate": _concat.SAMPLE_RATE,
        "chunks_processed": len(chunks),
    })


if __name__ == "__main__":
    main()
