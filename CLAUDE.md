# ChoiceVoice

Tauri 2 boombox TTS app. Local Qwen3-TTS via mlx-audio. Offline at runtime.

## Quick start

```bash
# Run the app
cd ~/Projects/ChoiceVoice
cargo tauri dev

# Test the sidecar directly (no Tauri needed)
cd ~/Projects/ChoiceVoice/sidecar
echo '{"text":"Hello world. Testing local TTS.","style":""}' \
  | uv run python -m choicevoice_tts \
      --job-id test-001 --speaker Ryan --language English \
      --model-size 1.7B --output /tmp/test.wav
```

## Local-only invariants

- This project is offline at runtime. Do not introduce any network calls
  outside of one-time model downloads from Hugging Face and the Google Fonts
  loaded by `ui-vite/index.html`.
- No telemetry, no API keys, no `.env` for secrets — there are none.
- Python: always `uv`, always `python3`. The sidecar venv lives at
  `sidecar/.venv` and is managed by `uv sync`.
- Sidecar protocol is JSON lines on stdout. Every sidecar event MUST be a
  single line of valid JSON terminated by `\n`. Malformed lines are a bug.
- WAV output is 24kHz 16-bit mono PCM. Do not change the sample rate
  without also updating the library metadata schema and the player.
- Work directly on main. No branches.
- Preserve the boombox aesthetic — silvery gunmetal panels, chunky controls,
  amber LCD, VT323 mono for LCD, Helvetica for chrome labels. If a change
  would visually degrade the front panel, push back instead of complying.

## Architecture

```
ui-vite/                Vite + React 19 frontend (ESM, real bundler)
  index.html            entry, loads Google Fonts
  src/
    main.jsx            createRoot bootstrap
    App.jsx             main app state + Tauri imports + library drawer
    boombox.jsx         visual primitives (MetalPanel, Knob, LCD, VU, etc.)
    tweaks-panel.jsx    dev tweaks panel + form-control helpers
    index.css           global cabinet/screw/library-drawer styles

src-tauri/src/
  lib.rs                plugin registration + command handler registration
  tts.rs                generate_speech Tauri command (spawns sidecar)
  library.rs            list_library, delete_library_entry commands

sidecar/
  choicevoice_tts/
    __main__.py         CLI entry (args + JSON stdin → JSONL stdout)
    engine.py           mlx-audio primary, qwen_tts torch_mps fallback
    chunker.py          text → ≤80-word chunks at sentence boundaries
    concat.py           stitch chunk arrays → 24kHz WAV
```

## Tauri 2 frontend wiring (important)

Tauri 2 does **not** inject `window.__TAURI__` globals by default. Always import
the JS API as ES modules — never rely on `window.__TAURI__.*`. Used here:

```js
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { save } from "@tauri-apps/plugin-dialog";
import { copyFile } from "@tauri-apps/plugin-fs";
```

Audio playback uses `convertFileSrc(path)` + `<audio>` element. The asset
protocol must be enabled in `tauri.conf.json` with a scope covering the
library path:

```json
"assetProtocol": {
  "enable": true,
  "scope": ["$HOME/Library/Application Support/com.choicevoice.app/library/**"]
}
```

## Sidecar stdin/stdout protocol

Rust writes ONE JSON line to stdin:
```json
{"text": "...", "style": "...or null"}
```

Sidecar emits JSONL events on stdout:
```json
{"event":"loading_model","model":"mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit","backend":"mlx"}
{"event":"model_loaded","backend":"mlx","load_ms":1200}
{"event":"chunked","total":4}
{"event":"chunk_done","i":1,"of":4,"samples":48000}
{"event":"complete","wav_path":"/abs/path.wav","duration_s":84.2,"sample_rate":24000,"chunks_processed":4}
```

## Library location

```
~/Library/Application Support/com.choicevoice.app/library/
  2026-05-05T19-24-00_ryan_abc123.wav
  2026-05-05T19-24-00_ryan_abc123.wav.json
```

## Status

- ✅ Phase 1 (sidecar): mlx-audio + Qwen3-TTS-12Hz-1.7B-Base-8bit, multi-chunk,
  JSONL protocol, WAV output.
- ✅ Phase 2 (Tauri shell): generate_speech, list_library, delete_library_entry.
  Sidecar wrapper for aarch64-apple-darwin.
- ✅ Phase 3 (UI integration): Vite + React 19 frontend renders, RECORD wires
  to sidecar via invoke, PLAY uses asset protocol, EJECT via dialog plugin,
  library drawer with click-to-play and delete. CLONE mode now records a
  reference clip from the mic via MediaRecorder (UI only — no clone backend).

## Known issues

- Voice still drifts slightly between chunks. The model architecture
  (VyvoTTS/SNAC) has no reference-audio input, so cross-chunk context isn't
  possible inside this model. Mitigation in place: per-speaker seeded RNG
  (`mx.random.seed(_speaker_seed(speaker))`), tightened sampler
  (`temperature=0.35, top_p=0.7`), and 120-word chunks instead of 80. For
  fully consistent long-form, swap to a model that supports a reference clip
  (F5-TTS, IndexTTS, XTTS).
- DESIGN and CLONE modes are UI-only — no backend invocation yet.
- The `web content process terminated` debug log on startup is normal WKWebView
  initialization noise.
- Speakers available (CustomVoice model): Vivian, Serena, Uncle_Fu, Dylan,
  Eric, Ryan, Aiden, Ono_Anna, Sohee.
