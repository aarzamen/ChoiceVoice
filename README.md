<!-- intro: Mike writes this -->
(Mike: one paragraph on why this exists.)

# ChoiceVoice

ChoiceVoice is a macOS desktop app, drawn as a boombox, that reads pasted text aloud with a Qwen3-TTS model running on your own Mac. It is for anyone who wants long-form narration (articles, scripts, chapters) generated locally, with no text leaving the machine.

## Screenshots

_No screenshots yet._
<!-- placeholder: add PNG files under docs/screenshots/ and embed them here -->

## What it does

- Paste text into the amber LCD and press RECORD. The app splits the text into chunks of up to 120 words at sentence boundaries, synthesises each chunk with Qwen3-TTS, and shows chunk-by-chunk progress on the LCD.
- Nine preset speakers (Vivian, Serena, Uncle_Fu, Dylan, Eric, Ryan, Aiden, Ono_Anna, Sohee), a LANG switch (Auto, English, Chinese, Japanese, Korean) and a MODEL switch (0.6B or 1.7B). The free-text STYLE field is experimental: on the MLX backend it is folded into the voice label and its effect on the output has not been verified.
- Every take is written as a 24 kHz 16-bit mono WAV, chunks joined with 150 ms of silence and peak-normalised, with a `.json` metadata file beside it, into the app's library folder.
- PLAY plays the last take back inside the app with the VU meters and cassette animating. STOP, REWIND and FF act on the current take, and the VOLUME knob sets playback level.
- EJECT opens a save dialog and copies the WAV wherever you choose.
- The LIBRARY drawer lists your 50 most recent takes, newest first, with click-to-play and delete.
- Runs offline. The only network use is the one-time model download from Hugging Face on the first RECORD (about 3.1 GB) and the Google Fonts request made by the UI.
- Experimental: if the MLX backend fails to load, the sidecar falls back to a PyTorch/MPS backend. That path needs the optional `torch` extra and a `Qwen3-TTS-main` checkout next to the repository, and is not part of the normal setup.

## Requirements

- A Mac with Apple silicon. The sidecar wrapper is built for `aarch64-apple-darwin` and mlx-audio needs Apple silicon.
- Xcode Command Line Tools, a Rust toolchain and the Tauri 2 CLI.
- Node.js 22 and npm.
- [uv](https://docs.astral.sh/uv/). It installs Python 3.12 or newer for the sidecar if needed.
- About 3.1 GB of disk for the model in the Hugging Face cache (`~/.cache/huggingface/hub/`), plus an internet connection for that first download only.

## Install and run (macOS)

Prerequisites:

```bash
xcode-select --install
brew install uv node
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install tauri-cli --version "^2"
```

Clone into `~/Projects/ChoiceVoice`. The bundled `.app` looks for the sidecar at that path, so other locations only work for `cargo tauri dev`:

```bash
git clone https://github.com/aarzamen/ChoiceVoice.git ~/Projects/ChoiceVoice
cd ~/Projects/ChoiceVoice
```

Frontend dependencies:

```bash
npm --prefix ui-vite ci
```

Sidecar Python environment:

```bash
cd sidecar && uv sync && cd ..
```

Run the app. This starts Vite on `127.0.0.1:1420` and opens the Tauri window:

```bash
cargo tauri dev
```

The first RECORD downloads the model into the Hugging Face cache and then synthesises. Later runs need no network.

To produce a `.app` bundle, run `cargo tauri build`. Tauri writes it under `src-tauri/target/release/bundle/`. The bundle still calls `uv` and the `sidecar/` source tree on this machine (see Status and limits).

## Front panel only (web, any OS)

The React front panel runs in a plain browser without Tauri. RECORD, PLAY and EJECT then run in a simulated mode (the LCD says `SIMULATED`) and no audio is generated. Useful for working on the chrome.

```bash
cd ui-vite
npm ci
npm run dev
```

Open <http://127.0.0.1:1420/>. `npm run build` writes a production bundle to `ui-vite/dist/`.

## Sidecar from the command line

The TTS engine is a Python package that reads one JSON line on stdin and writes JSON-line events on stdout. You can drive it without Tauri:

```bash
cd sidecar
echo '{"text":"Hello world. Testing local TTS.","style":""}' \
  | uv run python -m choicevoice_tts \
      --job-id test-001 --speaker Ryan --language English \
      --model-size 1.7B --output /tmp/test.wav
```

The last line of output is `{"event": "complete", ...}` with the WAV path and duration. Earlier lines report `loading_model`, `model_loaded`, `chunked` and `chunk_done`.

## Where files go

```
~/Library/Application Support/com.choicevoice.app/library/
  2026-05-05T19-24-00_ryan_abc123.wav
  2026-05-05T19-24-00_ryan_abc123.wav.json
```

Model weights live in the Hugging Face cache at `~/.cache/huggingface/hub/`.

## Status and limits

- Working: the sidecar (mlx-audio + `mlx-community/Qwen3-TTS-12Hz-1.7B-Base-8bit`, multi-chunk, JSONL protocol, WAV output), the Tauri commands (`generate_speech`, `list_library`, `delete_library_entry`) and the wired front panel (RECORD, PLAY, EJECT, LIBRARY).
- DESIGN and CLONE modes are UI only. CLONE records a reference clip from the microphone but nothing uses it yet, and the DESIGN description is not sent anywhere.
- The voice drifts slightly between chunks. The model has no reference-audio input, so this cannot be fixed inside this model. Mitigations in place: per-speaker seeded RNG, a tightened sampler and 120-word chunks.
- macOS on Apple silicon only. The sidecar is a bash wrapper that runs `uv run python -m choicevoice_tts`, so a built `.app` still needs `uv` and the `sidecar/` folder on the machine (it searches `~/Projects/ChoiceVoice/sidecar`).
- The 0.6B MODEL setting points at `mlx-community/Qwen3-TTS-12Hz-0.6B-Base-8bit`, which exists on Hugging Face, but it has not been tested in the app. Treat it as experimental.
- `npm run lint` reports pre-existing `react-hooks` errors. The build is unaffected.

## Licence

MIT. See [LICENSE](LICENSE).
