/* Choice Voice — Tauri-wired app (Vite/ESM port) */
import { useState, useEffect, useRef, useCallback } from "react";
import { invoke, convertFileSrc as tauriConvertFileSrc } from "@tauri-apps/api/core";
import { listen as tauriListen } from "@tauri-apps/api/event";
import { save as tauriSave } from "@tauri-apps/plugin-dialog";
import { copyFile as tauriCopyFile } from "@tauri-apps/plugin-fs";

import {
  MetalPanel, SpeakerGrille, Knob, TransportButton,
  LED, LCD, VUMeter, Cassette, ChunkySwitch,
} from "./boombox.jsx";
import {
  useTweaks, TweaksPanel, TweakSection, TweakToggle,
  TweakRadio, TweakButton,
} from "./tweaks-panel.jsx";

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function convertFileSrc(path) {
  if (!isTauri()) return path;
  try { return tauriConvertFileSrc(path); }
  catch (e) { return `asset://localhost/${encodeURIComponent(path)}`; }
}

let _audioCtx = null;
function getAudioCtx() {
  if (!_audioCtx) {
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { return null; }
  }
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}

function playClick(variant = "soft") {
  const ctx = getAudioCtx();
  if (!ctx) return;
  const now = ctx.currentTime;
  const profiles = {
    soft:   { noiseDur: 0.025, noiseGain: 0.35, ringFreq: 2400, ringDur: 0.07, ringGain: 0.18, lowFreq: 180, lowGain: 0.25 },
    hard:   { noiseDur: 0.035, noiseGain: 0.55, ringFreq: 3200, ringDur: 0.09, ringGain: 0.28, lowFreq: 130, lowGain: 0.40 },
    record: { noiseDur: 0.045, noiseGain: 0.50, ringFreq: 1800, ringDur: 0.12, ringGain: 0.30, lowFreq: 110, lowGain: 0.45 },
    eject:  { noiseDur: 0.060, noiseGain: 0.45, ringFreq: 1400, ringDur: 0.18, ringGain: 0.22, lowFreq: 90,  lowGain: 0.40 },
  };
  const p = profiles[variant] || profiles.soft;
  const bufLen = Math.floor(ctx.sampleRate * p.noiseDur);
  const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1);
  const noise = ctx.createBufferSource();
  noise.buffer = buf;
  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass"; bp.frequency.value = 3500; bp.Q.value = 1.2;
  const nGain = ctx.createGain();
  nGain.gain.setValueAtTime(p.noiseGain, now);
  nGain.gain.exponentialRampToValueAtTime(0.001, now + p.noiseDur);
  noise.connect(bp).connect(nGain).connect(ctx.destination);
  noise.start(now); noise.stop(now + p.noiseDur);
  const osc = ctx.createOscillator();
  osc.type = "triangle"; osc.frequency.value = p.ringFreq;
  const oGain = ctx.createGain();
  oGain.gain.setValueAtTime(p.ringGain, now);
  oGain.gain.exponentialRampToValueAtTime(0.001, now + p.ringDur);
  osc.connect(oGain).connect(ctx.destination);
  osc.start(now); osc.stop(now + p.ringDur);
  const lowOsc = ctx.createOscillator();
  lowOsc.type = "sine"; lowOsc.frequency.setValueAtTime(p.lowFreq * 1.6, now);
  lowOsc.frequency.exponentialRampToValueAtTime(p.lowFreq, now + 0.04);
  const lGain = ctx.createGain();
  lGain.gain.setValueAtTime(p.lowGain, now);
  lGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
  lowOsc.connect(lGain).connect(ctx.destination);
  lowOsc.start(now); lowOsc.stop(now + 0.08);
}

const SPEAKERS = [
  { id: "Vivian",   desc: "Bright, slightly edgy young female",   lang: "Chinese",  flag: "CN" },
  { id: "Serena",   desc: "Warm, gentle young female",            lang: "Chinese",  flag: "CN" },
  { id: "Uncle_Fu", desc: "Seasoned male, low mellow timbre",     lang: "Chinese",  flag: "CN" },
  { id: "Dylan",    desc: "Youthful Beijing male, clear timbre",  lang: "Chinese",  flag: "CN" },
  { id: "Eric",     desc: "Lively Chengdu male, husky brightness",lang: "Chinese",  flag: "CN" },
  { id: "Ryan",     desc: "Dynamic male, strong rhythmic drive",  lang: "English",  flag: "US" },
  { id: "Aiden",    desc: "Sunny American male, clear midrange",  lang: "English",  flag: "US" },
  { id: "Ono_Anna", desc: "Playful Japanese female, light timbre",lang: "Japanese", flag: "JP" },
  { id: "Sohee",    desc: "Warm Korean female, rich emotion",     lang: "Korean",   flag: "KR" },
];

const MODES = ["TTS", "DESIGN", "CLONE"];

const DEFAULT_TEXT = `Welcome to Choice Voice. Paste a long document, an article, or a script into this display, then press RECORD to synthesize. The cassette will spin while each chunk is processed by the Qwen3 model running locally on this Mac. Press PLAY to hear it back, or EJECT to save the WAV file to your disk.`;

function LibraryDrawer({ open, onClose, onPlay, onDelete }) {
  const [entries, setEntries] = useState([]);
  const [playingPath, setPlayingPath] = useState(null);

  const refresh = useCallback(async () => {
    if (!isTauri()) return;
    try {
      const list = await invoke("list_library");
      setEntries(list || []);
    } catch (e) {
      console.warn("list_library:", e);
    }
  }, []);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handlePlay = (entry) => {
    setPlayingPath(entry.wav_path);
    onPlay(entry.wav_path, entry.duration_s);
  };

  const handleDelete = async (entry) => {
    if (!isTauri()) return;
    await invoke("delete_library_entry", { wavPath: entry.wav_path });
    refresh();
    if (playingPath === entry.wav_path) { setPlayingPath(null); onDelete(); }
  };

  const formatDur = (s) => {
    const m = Math.floor(s / 60);
    return `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
  };

  return (
    <div className={`library-drawer${open ? " open" : ""}`}>
      <div style={{
        padding: "14px 16px",
        borderBottom: "1px solid #2a2c30",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "linear-gradient(180deg, #2a2c30, #1a1b1d)",
      }}>
        <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 18, letterSpacing: 3, color: "#c8cacc" }}>LIBRARY</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={refresh} style={drawerBtnStyle}>↺</button>
          <button onClick={onClose} style={drawerBtnStyle}>✕</button>
        </div>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {entries.length === 0 && (
          <div style={{ padding: 24, color: "#555", fontFamily: "'VT323', monospace", fontSize: 16, textAlign: "center" }}>
            — NO RECORDINGS —
          </div>
        )}
        {entries.map((e) => (
          <div key={e.job_id} className={`library-entry${playingPath === e.wav_path ? " playing" : ""}`}
            onClick={() => handlePlay(e)}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <span style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 13, letterSpacing: 2, color: "#c8cacc" }}>
                {e.speaker.toUpperCase()}
              </span>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span style={{ fontFamily: "'VT323', monospace", fontSize: 13, color: "#ffb020" }}>
                  {formatDur(e.duration_s)}
                </span>
                <button
                  onClick={(ev) => { ev.stopPropagation(); handleDelete(e); }}
                  style={{ ...drawerBtnStyle, fontSize: 10, padding: "2px 6px", color: "#ff3b2f" }}>✕</button>
              </div>
            </div>
            <div style={{ fontFamily: "'VT323', monospace", fontSize: 13, color: "#666", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.text_preview}
            </div>
            <div style={{ fontFamily: "'VT323', monospace", fontSize: 12, color: "#444", marginTop: 2 }}>
              {e.created_at.slice(0, 16).replace("T", "  ")}  ·  {e.model_size}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const drawerBtnStyle = {
  background: "transparent",
  border: "1px solid #3a3c40",
  color: "#888",
  borderRadius: 3,
  padding: "4px 8px",
  cursor: "pointer",
  fontFamily: "'Bebas Neue', sans-serif",
  fontSize: 12,
  letterSpacing: 1,
};

export default function App() {
  const [tweaks, setTweak] = useTweaks({
    "panelTone": "silver",
    "ledColor": "#ff3b2f",
    "lcdTint": "amber",
    "showWoodCabinet": true,
    "compactMode": false,
  });

  const [mode, setMode] = useState("TTS");
  const [text, setText] = useState(DEFAULT_TEXT);
  const [language, setLanguage] = useState("Auto");
  const [speaker, setSpeaker] = useState("Ryan");
  const [styleInstruct, setStyleInstruct] = useState("");
  const [voiceDesc, setVoiceDesc] = useState("Warm narrator, mid-range, calm pacing with subtle warmth.");
  const [refText, setRefText] = useState("");
  const [refFile, setRefFile] = useState(null);
  const [refRecording, setRefRecording] = useState(false);
  const [refUrl, setRefUrl] = useState(null);
  const [refDuration, setRefDuration] = useState(0);
  const refRecorderRef = useRef(null);
  const refStartTimeRef = useRef(0);
  const [modelSize, setModelSize] = useState("1.7B");

  const [status, setStatus] = useState("READY");
  const [phase, setPhase] = useState("idle");
  const [progress, setProgress] = useState(0);
  const [vu, setVu] = useState({ l: 0, r: 0 });
  const [volume, setVolume] = useState(0.7);
  const [tone, setTone] = useState(0.55);
  const [speed, setSpeed] = useState(0.5);
  const [chunks, setChunks] = useState([]);
  const [activeChunk, setActiveChunk] = useState(-1);
  const [totalChunks, setTotalChunks] = useState(0);
  const [hasRecording, setHasRecording] = useState(false);
  const [currentWav, setCurrentWav] = useState(null);
  const [currentDuration, setCurrentDuration] = useState(0);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const audioRef = useRef(null);
  const vuTickRef = useRef(null);
  const tickRef = useRef(null);

  useEffect(() => {
    const sentences = text.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) || [];
    const out = [];
    let buf = "";
    for (const s of sentences) {
      if (buf.length + s.length > 120 && buf) { out.push(buf.trim()); buf = ""; }
      buf += s;
    }
    if (buf.trim()) out.push(buf.trim());
    setChunks(out.slice(0, 32));
  }, [text]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten = null;
    tauriListen("tts://progress", (ev) => {
      const data = ev.payload;
      const event = data.event;

      if (event === "loading_model") {
        setStatus(`⟳ LOADING MODEL…`);
      } else if (event === "model_loaded") {
        setStatus(`✓ MODEL READY  [${(data.load_ms / 1000).toFixed(1)}s]`);
      } else if (event === "chunked") {
        setTotalChunks(data.total);
        setStatus(`● REC  0 / ${data.total} CHUNKS`);
      } else if (event === "chunk_done") {
        setActiveChunk(data.i - 1);
        setProgress(data.i / (data.of || 1));
        setStatus(`● REC  CHUNK ${data.i} / ${data.of}`);
        setVu({ l: 0.3 + Math.random() * 0.6, r: 0.3 + Math.random() * 0.6 });
      } else if (event === "complete") {
        // handled in startRecord resolve
      } else if (event === "error") {
        setStatus(`✗ ERROR: ${data.message || "unknown"}`);
        setPhase("idle");
        setVu({ l: 0, r: 0 });
      } else if (event === "first_run_setup") {
        setStatus(`⟳ FIRST RUN: INSTALLING DEPS…`);
      } else if (event === "downloading_model") {
        setStatus(`⟳ DOWNLOADING MODEL…`);
      }
    }).then(fn => { unlisten = fn; }).catch(e => console.warn("listen failed:", e));
    return () => { if (unlisten) unlisten(); };
  }, []);

  const startRecord = async () => {
    playClick("record");
    if (phase === "recording" || !text.trim()) return;
    setPhase("recording");
    setStatus("● REC  STARTING…");
    setProgress(0);
    setActiveChunk(-1);
    setTotalChunks(0);
    setHasRecording(false);
    setCurrentWav(null);

    if (!isTauri()) {
      let p = 0, chunkI = 0;
      clearInterval(tickRef.current);
      tickRef.current = setInterval(() => {
        p += 0.012 + Math.random() * 0.008;
        const cI = Math.min(chunks.length - 1, Math.floor(p * chunks.length));
        if (cI !== chunkI) { chunkI = cI; setActiveChunk(cI); }
        setProgress(Math.min(1, p));
        setVu({ l: 0.15 + Math.random() * 0.7, r: 0.15 + Math.random() * 0.7 });
        if (p >= 1) {
          clearInterval(tickRef.current);
          setPhase("done");
          setStatus("✓ READY  • SIMULATED (no Tauri)");
          setVu({ l: 0, r: 0 });
          setHasRecording(true);
          setActiveChunk(-1);
        }
      }, 80);
      return;
    }

    try {
      const result = await invoke("generate_speech", {
        request: {
          text,
          speaker,
          language,
          style: styleInstruct || null,
          model_size: modelSize,
        }
      });
      setCurrentWav(result.wav_path);
      setCurrentDuration(result.duration_s);
      setHasRecording(true);
      setPhase("done");
      setActiveChunk(-1);
      setVu({ l: 0, r: 0 });
      const dur = formatTime(result.duration_s);
      setStatus(`✓ READY  • ${dur}  [${result.chunks_processed} CHUNKS]`);
    } catch (e) {
      setStatus(`✗ ERROR: ${String(e)}`);
      setPhase("idle");
      setVu({ l: 0, r: 0 });
    }
  };

  const stopAll = () => {
    playClick("hard");
    clearInterval(tickRef.current);
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.currentTime = 0; }
    clearInterval(vuTickRef.current);
    setPhase("idle");
    setStatus("■ STOPPED");
    setVu({ l: 0, r: 0 });
    setActiveChunk(-1);
    setProgress(0);
  };

  const playBack = () => {
    playClick("soft");
    if (!hasRecording) {
      setStatus("✗ NO TAPE — RECORD FIRST");
      return;
    }
    if (!isTauri() || !currentWav) {
      setPhase("playing");
      setStatus("▶ PLAYING  • 0:00 / 1:24");
      setProgress(0);
      let p = 0;
      clearInterval(tickRef.current);
      tickRef.current = setInterval(() => {
        p += 0.008;
        setProgress(Math.min(1, p));
        setVu({ l: 0.2 + Math.sin(p * 30) * 0.3 + Math.random() * 0.15, r: 0.2 + Math.sin(p * 30 + 1) * 0.3 + Math.random() * 0.15 });
        const sec = Math.floor(p * 84);
        setStatus(`▶ PLAYING  • 0:${String(sec).padStart(2, "0")} / 1:24`);
        if (p >= 1) { clearInterval(tickRef.current); setPhase("done"); setStatus("✓ END OF TAPE"); setVu({ l: 0, r: 0 }); }
      }, 80);
      return;
    }
    const src = convertFileSrc(currentWav);
    if (!audioRef.current) return;
    audioRef.current.src = src;
    audioRef.current.volume = volume;
    audioRef.current.play().catch(e => setStatus(`✗ PLAY ERR: ${e.message}`));
    setPhase("playing");
    setProgress(0);
    setStatus(`▶ PLAYING  • 0:00 / ${formatTime(currentDuration)}`);

    clearInterval(vuTickRef.current);
    const startTime = Date.now();
    vuTickRef.current = setInterval(() => {
      const elapsed = (Date.now() - startTime) / 1000;
      const p = Math.min(1, elapsed / Math.max(currentDuration, 1));
      setProgress(p);
      setVu({
        l: 0.2 + Math.sin(elapsed * 8) * 0.25 + Math.random() * 0.2,
        r: 0.2 + Math.sin(elapsed * 8 + 1.5) * 0.25 + Math.random() * 0.2,
      });
      setStatus(`▶ PLAYING  • ${formatTime(elapsed)} / ${formatTime(currentDuration)}`);
      if (p >= 1) {
        clearInterval(vuTickRef.current);
        setPhase("done");
        setStatus("✓ END OF TAPE");
        setVu({ l: 0, r: 0 });
      }
    }, 80);
  };

  const eject = async () => {
    playClick("eject");
    if (!hasRecording) { setStatus("✗ NOTHING TO EJECT"); return; }
    if (!isTauri() || !currentWav) { setStatus("⇩ SAVED → ~/Desktop/choice_voice_output.wav (simulated)"); return; }
    try {
      const dest = await tauriSave({
        defaultPath: `choice_voice_${speaker.toLowerCase()}.wav`,
        filters: [{ name: "WAV Audio", extensions: ["wav"] }],
      });
      if (!dest) return;
      await tauriCopyFile(currentWav, dest);
      setStatus(`⇩ SAVED → ${dest.split("/").pop()}`);
    } catch (e) {
      setStatus(`✗ EJECT ERR: ${String(e)}`);
    }
  };

  const startRefRecording = async () => {
    playClick("record");
    if (refRecording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: rec.mimeType || "audio/webm" });
        const file = new File([blob], `ref_${Date.now()}.${(rec.mimeType || "audio/webm").includes("mp4") ? "m4a" : "webm"}`, { type: blob.type });
        if (refUrl) URL.revokeObjectURL(refUrl);
        const url = URL.createObjectURL(blob);
        setRefFile(file);
        setRefUrl(url);
        setRefDuration((Date.now() - refStartTimeRef.current) / 1000);
        setRefRecording(false);
        refRecorderRef.current = null;
      };
      refStartTimeRef.current = Date.now();
      rec.start();
      refRecorderRef.current = rec;
      setRefRecording(true);
    } catch (e) {
      setStatus(`✗ MIC ERR: ${e.message || e}`);
      setRefRecording(false);
    }
  };

  const stopRefRecording = () => {
    playClick("hard");
    const rec = refRecorderRef.current;
    if (rec && rec.state !== "inactive") rec.stop();
  };

  const clearRefRecording = () => {
    playClick("soft");
    if (refUrl) URL.revokeObjectURL(refUrl);
    setRefFile(null);
    setRefUrl(null);
    setRefDuration(0);
  };

  const rewind = () => {
    playClick("soft");
    setProgress(0);
    if (audioRef.current) audioRef.current.currentTime = 0;
    setStatus("◀◀ REWIND");
  };
  const ffwd = () => {
    playClick("soft");
    setProgress(1);
    setStatus("▶▶ END");
  };

  const charCount = text.length;
  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estDur = Math.round(wordCount / 2.5);

  const labelTag = (txt, color = "#1a1b1d") => (
    <div style={{
      display: "inline-block",
      background: color,
      color: "#efe9d6",
      fontFamily: "'Bebas Neue', sans-serif",
      letterSpacing: 2.5, fontSize: 10,
      padding: "3px 8px",
      borderRadius: 2,
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15), 0 1px 0 rgba(255,255,255,0.4)",
    }}>{txt}</div>
  );

  const cabinetBg = tweaks.showWoodCabinet
    ? `linear-gradient(180deg, #4a3520 0%, #3a2818 50%, #2a1c10 100%)`
    : "#0a0a0b";

  return (
    <div style={{ minHeight: "100vh", display: "flex", justifyContent: "center", alignItems: "flex-start", padding: "30px 20px 60px" }}>
      <audio ref={audioRef} style={{ display: "none" }}
        onEnded={() => { clearInterval(vuTickRef.current); setPhase("done"); setStatus("✓ END OF TAPE"); setVu({ l: 0, r: 0 }); setProgress(1); }}
      />

      <div style={{
        width: "100%", maxWidth: 1240,
        background: cabinetBg,
        backgroundImage: tweaks.showWoodCabinet
          ? `linear-gradient(180deg, #4a3520 0%, #3a2818 50%, #2a1c10 100%),
             repeating-linear-gradient(90deg, rgba(0,0,0,0.25) 0 1px, transparent 1px 4px),
             repeating-linear-gradient(90deg, rgba(255,200,150,0.05) 0 2px, transparent 2px 11px)`
          : "none",
        backgroundBlendMode: "multiply",
        borderRadius: 12,
        padding: 14,
        boxShadow: `inset 0 1px 0 rgba(255,220,180,0.3), inset 0 -2px 4px rgba(0,0,0,0.6), 0 30px 60px rgba(0,0,0,0.7), 0 10px 20px rgba(0,0,0,0.5)`,
        border: tweaks.showWoodCabinet ? "1px solid #1a0e08" : "1px solid #333",
      }}>
        <MetalPanel tone={tweaks.panelTone === "warm" ? "warm" : "silver"} style={{
          borderRadius: 6, padding: "10px 16px",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          marginBottom: 10,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div className="screw" />
            <div style={{ fontFamily: "'Bebas Neue', sans-serif", fontSize: 28, letterSpacing: 6, color: "#1a1b1d", textShadow: "0 1px 0 rgba(255,255,255,0.6), 0 -1px 0 rgba(0,0,0,0.2)", fontWeight: 700 }}>CHOICE — VOICE</div>
            <div style={{ fontFamily: "'VT323', monospace", fontSize: 13, color: "#444", borderLeft: "2px solid #6c6e72", paddingLeft: 12, letterSpacing: 1 }}>STEREO · TTS · MODEL DSV-1700</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <LED color="#ff3b2f" on={phase === "recording"} label="REC" />
            <LED color="#4cff5a" on={phase === "playing"} label="PLAY" />
            <LED color="#ffb020" on={hasRecording && phase === "idle"} label="TAPE" />
            <LED color="#4cdfff" on={true} label="PWR" />
            <button onClick={() => setLibraryOpen(o => !o)} style={{
              background: libraryOpen ? "#1a2a1a" : "transparent",
              border: "1px solid #4a4d52",
              color: libraryOpen ? "#4cff5a" : "#888",
              fontFamily: "'Bebas Neue', sans-serif",
              letterSpacing: 2, fontSize: 10,
              padding: "4px 10px", borderRadius: 3, cursor: "pointer",
            }}>LIBRARY</button>
            <div className="screw" />
          </div>
        </MetalPanel>

        <MetalPanel tone={tweaks.panelTone === "warm" ? "warm" : "silver"} style={{ borderRadius: 6, padding: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "240px 1fr 240px", gap: 16, alignItems: "stretch" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <SpeakerGrille size={228} label="WOOFER · 6.5″" />
              <div style={{ display: "flex", gap: 16 }}>
                <Knob value={volume} onChange={setVolume} label="VOLUME" accent="#ff3b2f" />
                <Knob value={tone} onChange={setTone} label="TONE" accent="#ffb020" />
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 10, alignItems: "stretch" }}>
                <ChunkySwitch value={mode} onChange={setMode} options={MODES} label="MODE" />
                <LCD style={{ flex: 1, padding: "8px 14px", display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 16, gap: 12, whiteSpace: "nowrap" }}>
                  <span style={{ letterSpacing: 2 }}>{mode === "TTS" ? "▌ PRESET VOICE" : mode === "DESIGN" ? "▌ VOICE DESIGN" : "▌ VOICE CLONE"}</span>
                  <span style={{ fontSize: 14, opacity: 0.75 }}>{charCount.toLocaleString()}c · {wordCount.toLocaleString()}w · ~{estDur}s</span>
                </LCD>
              </div>

              <LCD style={{ padding: 0 }}>
                <div style={{ padding: "10px 14px 4px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(0,0,0,0.25)" }}>
                  <span style={{ fontSize: 16, letterSpacing: 2 }}>▌ DOCUMENT INPUT</span>
                  <span style={{ fontSize: 14, opacity: 0.7 }}>{chunks.length} CHUNK{chunks.length === 1 ? "" : "S"}</span>
                </div>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="// PASTE DOCUMENT, SCRIPT, OR ARTICLE HERE…"
                  style={{ width: "100%", minHeight: 180, background: "transparent", border: "none", outline: "none", color: "#1a2a08", fontFamily: "'VT323', 'Share Tech Mono', monospace", fontSize: 19, lineHeight: 1.35, padding: "10px 14px 14px", resize: "vertical", boxSizing: "border-box", letterSpacing: 0.5 }}
                />
              </LCD>

              {mode === "TTS" && (
                <MetalPanel tone="dark" inset style={{ borderRadius: 5, padding: 12, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                  {labelTag("SPEAKER")}
                  <select value={speaker} onChange={(e) => setSpeaker(e.target.value)} style={selectStyle}>
                    {SPEAKERS.map(s => <option key={s.id} value={s.id}>{s.id} — {s.desc} [{s.flag}]</option>)}
                  </select>
                  {labelTag("LANG")}
                  <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ ...selectStyle, maxWidth: 130 }}>
                    {["Auto", "English", "Chinese", "Japanese", "Korean"].map(l => <option key={l}>{l}</option>)}
                  </select>
                  {labelTag("STYLE")}
                  <input value={styleInstruct} onChange={(e) => setStyleInstruct(e.target.value)}
                    placeholder="e.g. cheerful and energetic"
                    style={{ ...inputStyle, flex: 1, minWidth: 180 }} />
                </MetalPanel>
              )}

              {mode === "DESIGN" && (
                <MetalPanel tone="dark" inset style={{ borderRadius: 5, padding: 12, display: "flex", gap: 10, alignItems: "flex-start" }}>
                  {labelTag("DESIGN")}
                  <textarea value={voiceDesc} onChange={(e) => setVoiceDesc(e.target.value)}
                    placeholder="Describe the target voice in natural language…"
                    style={{ ...inputStyle, flex: 1, minHeight: 56, resize: "vertical", fontFamily: "'Share Tech Mono', monospace" }} />
                  {labelTag("LANG")}
                  <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{ ...selectStyle, maxWidth: 130 }}>
                    {["Auto", "English", "Chinese", "Japanese", "Korean"].map(l => <option key={l}>{l}</option>)}
                  </select>
                </MetalPanel>
              )}

              {mode === "CLONE" && (
                <MetalPanel tone="dark" inset style={{ borderRadius: 5, padding: 12, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  {labelTag("REF AUDIO")}
                  {!refFile && !refRecording && (
                    <button
                      onClick={startRefRecording}
                      style={{
                        ...inputStyle,
                        cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 8,
                        color: "#ff3b2f",
                        fontFamily: "'Bebas Neue', sans-serif",
                        letterSpacing: 2, fontSize: 12,
                        padding: "8px 14px",
                      }}>
                      <span style={{ fontSize: 14 }}>●</span> RECORD REFERENCE
                    </button>
                  )}
                  {refRecording && (
                    <button
                      onClick={stopRefRecording}
                      style={{
                        ...inputStyle,
                        cursor: "pointer",
                        display: "flex", alignItems: "center", gap: 8,
                        background: "#3a1a1a",
                        color: "#ff3b2f",
                        fontFamily: "'Bebas Neue', sans-serif",
                        letterSpacing: 2, fontSize: 12,
                        padding: "8px 14px",
                        boxShadow: "inset 0 0 0 1px #ff3b2f, 0 0 8px rgba(255,59,47,0.4)",
                      }}>
                      <span style={{ fontSize: 14, animation: "spin 1.6s linear infinite" }}>●</span> STOP RECORDING
                    </button>
                  )}
                  {refFile && !refRecording && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <audio src={refUrl} controls
                        style={{ height: 28, filter: "invert(0.85) hue-rotate(180deg)" }} />
                      <span style={{ fontFamily: "'VT323', monospace", fontSize: 13, color: "#4cff5a" }}>
                        {refDuration.toFixed(1)}s
                      </span>
                      <button onClick={clearRefRecording}
                        style={{
                          background: "transparent", border: "1px solid #4a4d52",
                          color: "#888", borderRadius: 3,
                          padding: "4px 8px", cursor: "pointer",
                          fontFamily: "'Bebas Neue', sans-serif", fontSize: 10, letterSpacing: 1.5,
                        }}>RE-DO</button>
                    </div>
                  )}
                  {labelTag("REF TEXT")}
                  <input value={refText} onChange={(e) => setRefText(e.target.value)}
                    placeholder="Transcript of reference audio"
                    style={{ ...inputStyle, flex: 1, minWidth: 200 }} />
                </MetalPanel>
              )}

              <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 10 }}>
                <Cassette
                  spinning={phase === "recording" || phase === "playing"}
                  progress={progress}
                  label={`TAPE  ${formatTime(progress * currentDuration)} / ${formatTime(currentDuration)}`}
                />
                <MetalPanel tone="dark" inset style={{ borderRadius: 5, padding: 10, display: "flex", flexDirection: "column", gap: 8, minHeight: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    {labelTag("CHUNK QUEUE", "#0a0a0b")}
                    <span style={{ fontFamily: "'VT323', monospace", color: "#ffb020", fontSize: 14 }}>
                      {phase === "recording" && activeChunk >= 0
                        ? `PROCESSING ${activeChunk + 1} / ${totalChunks || chunks.length}`
                        : `${chunks.length} SEGMENTS`}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 3, flexWrap: "wrap", overflow: "hidden", maxHeight: 60 }}>
                    {chunks.map((c, i) => {
                      const done = phase === "recording" ? i < activeChunk : (hasRecording ? true : false);
                      const active = i === activeChunk && phase === "recording";
                      return (
                        <div key={i} title={c} style={{
                          width: 18, height: 11,
                          background: active ? "#ffb020" : (done ? "#4cff5a" : "#1a2a1a"),
                          boxShadow: active ? "0 0 6px #ffb020" : (done ? "0 0 4px #4cff5a" : "inset 0 1px 1px rgba(0,0,0,0.6)"),
                          borderRadius: 1, transition: "background 0.1s",
                        }} />
                      );
                    })}
                    {chunks.length === 0 && <div style={{ color: "#666", fontFamily: "'VT323', monospace", fontSize: 14 }}>— EMPTY —</div>}
                  </div>
                  <VUMeter level={vu.l} label="L" />
                  <VUMeter level={vu.r} label="R" />
                </MetalPanel>
              </div>

              <LCD style={{ padding: "8px 14px", fontSize: 18, letterSpacing: 1.5 }}>
                <span style={{ opacity: 0.6 }}>STATUS ▸</span>&nbsp;{status}
              </LCD>

              <MetalPanel tone="dark" style={{ borderRadius: 5, padding: 10, display: "flex", gap: 8, alignItems: "center", justifyContent: "space-between" }}>
                <div style={{ display: "flex", gap: 6 }}>
                  <TransportButton icon="◀◀" label="REW"   onClick={rewind} />
                  <TransportButton icon="▶"  label="PLAY"  onClick={playBack} active={phase === "playing"} />
                  <TransportButton icon="■"  label="STOP"  onClick={stopAll} />
                  <TransportButton icon="▶▶" label="FFWD"  onClick={ffwd} />
                  <TransportButton icon="●"  label="REC"   onClick={startRecord} active={phase === "recording"} danger />
                  <TransportButton icon="⏏"  label="EJECT" onClick={eject} />
                </div>
                <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                  <Knob value={speed} onChange={setSpeed} label="SPEED" accent="#4cff5a" size={56} />
                  <ChunkySwitch value={modelSize} onChange={setModelSize} options={["0.6B", "1.7B"]} label="MODEL" />
                </div>
              </MetalPanel>
            </div>

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
              <SpeakerGrille size={228} label="WOOFER · 6.5″" />
              <div style={{ display: "flex", gap: 16 }}>
                <Knob value={0.6} onChange={() => {}} label="BASS" accent="#ff3b2f" />
                <Knob value={0.45} onChange={() => {}} label="TREBLE" accent="#ffb020" />
              </div>
            </div>
          </div>

          <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
            <div style={{ width: 320, height: 12, background: "linear-gradient(180deg, #2a2c30, #0a0a0b)", borderRadius: "0 0 14px 14px", boxShadow: "inset 0 -2px 4px rgba(0,0,0,0.7), 0 2px 4px rgba(0,0,0,0.4)", position: "relative" }}>
              <div style={{ position: "absolute", left: -8, top: 2, width: 6, height: 6, background: "#1a1b1d", borderRadius: "50%" }} />
              <div style={{ position: "absolute", right: -8, top: 2, width: 6, height: 6, background: "#1a1b1d", borderRadius: "50%" }} />
            </div>
          </div>

          <div style={{ marginTop: 12, display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 4px", fontFamily: "'VT323', monospace", color: "#444", fontSize: 13, letterSpacing: 1 }}>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <div className="screw" />
              <span>QWEN-3 · 12Hz · {modelSize}</span>
              <span>·</span>
              <span>MLX-AUDIO</span>
              <span>·</span>
              <span>TAURI 2.0</span>
            </div>
            <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
              <span>SERIAL: CV-198X-{(charCount % 9999).toString().padStart(4, "0")}</span>
              <div className="screw" />
            </div>
          </div>
        </MetalPanel>
      </div>

      <LibraryDrawer
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        onPlay={(wavPath, dur) => {
          setCurrentWav(wavPath);
          setCurrentDuration(dur);
          setHasRecording(true);
          setLibraryOpen(false);
          setTimeout(playBack, 50);
        }}
        onDelete={() => {}}
      />

      <TweaksPanel title="Tweaks">
        <TweakSection label="Cabinet">
          <TweakToggle label="Wood cabinet" value={tweaks.showWoodCabinet} onChange={(v) => setTweak("showWoodCabinet", v)} />
          <TweakRadio label="Panel tone" value={tweaks.panelTone}
            options={[{ label: "Silver", value: "silver" }, { label: "Warm", value: "warm" }]}
            onChange={(v) => setTweak("panelTone", v)} />
        </TweakSection>
        <TweakSection label="Demo">
          <TweakButton label="Load Sample Doc" onClick={() => setText(SAMPLE_LONG)} />
          <TweakButton label="Reset" onClick={() => { setText(DEFAULT_TEXT); setHasRecording(false); setProgress(0); setStatus("READY"); setCurrentWav(null); }} />
        </TweakSection>
      </TweaksPanel>
    </div>
  );
}

function formatTime(s) {
  s = Math.max(0, s || 0);
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

const selectStyle = {
  background: "linear-gradient(180deg, #2a2c30, #0a0a0b)",
  color: "#cdcfd2",
  border: "1px solid #000",
  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.1), inset 0 -2px 3px rgba(0,0,0,0.6)",
  padding: "6px 8px",
  borderRadius: 3,
  fontFamily: "'Share Tech Mono', monospace",
  fontSize: 12,
  outline: "none",
};

const inputStyle = {
  background: "linear-gradient(180deg, #1a1b1d, #0a0a0b)",
  color: "#cdcfd2",
  border: "1px solid #000",
  boxShadow: "inset 0 2px 4px rgba(0,0,0,0.7)",
  padding: "8px 10px",
  borderRadius: 3,
  fontFamily: "'Share Tech Mono', monospace",
  fontSize: 12,
  outline: "none",
};

const SAMPLE_LONG = `Chapter One. The lighthouse keeper had not slept in three days. Each night the fog rolled in thicker than the last, a wet gray wall that swallowed the beam before it could reach the rocks. He climbed the iron stairs at dusk with a kerosene can in one hand and a cold sandwich in the other, the same way he had for thirty-one years. The wind moaned through the seams of the tower and the gulls had long since given up and gone inland. Down at the harbor the fishing boats rocked at their moorings, their lines creaking like old men remembering a war. He thought of his wife, dead now nine winters, and of the letter from his daughter folded twice in his coat pocket. She wanted him to come live with her in Portland. He had not yet decided what to write back. The lamp room smelled of brass polish and salt. He set the can down, struck a match, and watched the wick catch and grow into a small steady flame. Then he turned the lens, and the light went out across the water, sweeping once, twice, three times — searching, the way it always did, for something that was not there.`;
