/* Boombox visual primitives — silver chassis, knobs, LCD, VU meter, cassette */
import { useEffect, useRef } from "react";

export function MetalPanel({ children, style, className, inset, tone = "silver" }) {
  const tones = {
    silver: `linear-gradient(180deg, #f0f1f3 0%, #d4d6d9 18%, #b8babd 50%, #d4d6d9 82%, #f0f1f3 100%)`,
    dark:   `linear-gradient(180deg, #5a5d62 0%, #3c3e42 18%, #2c2e32 50%, #3c3e42 82%, #5a5d62 100%)`,
    warm:   `linear-gradient(180deg, #ebe6dc 0%, #cdc8be 50%, #ebe6dc 100%)`,
  };
  return (
    <div
      className={className}
      style={{
        background: tones[tone],
        backgroundImage: `${tones[tone]}, repeating-linear-gradient(90deg, rgba(0,0,0,0.06) 0 1px, transparent 1px 3px)`,
        backgroundBlendMode: "multiply",
        boxShadow: inset
          ? "inset 0 2px 4px rgba(0,0,0,0.55), inset 0 -1px 0 rgba(255,255,255,0.25), 0 1px 0 rgba(255,255,255,0.4)"
          : "inset 0 1px 0 rgba(255,255,255,0.6), inset 0 -2px 4px rgba(0,0,0,0.35), 0 2px 4px rgba(0,0,0,0.4)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

export function SpeakerGrille({ size = 280, label }) {
  const dots = [];
  const cols = Math.floor(size / 12);
  const rows = Math.floor(size / 12);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * 12 + (r % 2 ? 6 : 0) + 8;
      const y = r * 10 + 8;
      const cx = size / 2, cy = size / 2;
      const d = Math.hypot(x - cx, y - cy);
      if (d > size / 2 - 8) continue;
      dots.push(<circle key={`${r}-${c}`} cx={x} cy={y} r="2.6" fill="url(#hole)" />);
    }
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: "50%",
      background: `
        radial-gradient(circle at 35% 30%, #1a1a1c 0%, #0a0a0b 60%),
        linear-gradient(135deg, #2a2c30, #0a0a0b)`,
      boxShadow: `
        inset 0 0 0 6px #1a1b1d,
        inset 0 0 0 8px #6c6e72,
        inset 0 0 0 14px #2a2c30,
        inset 0 0 0 16px #b8babd,
        inset 0 0 30px rgba(0,0,0,0.9),
        0 4px 12px rgba(0,0,0,0.6)`,
      position: "relative",
      flexShrink: 0,
    }}>
      <svg width={size} height={size} style={{ display: "block", borderRadius: "50%" }}>
        <defs>
          <radialGradient id="hole">
            <stop offset="0%" stopColor="#000" />
            <stop offset="70%" stopColor="#0a0a0b" />
            <stop offset="100%" stopColor="#3a3c40" />
          </radialGradient>
        </defs>
        {dots}
      </svg>
      {label && (
        <div style={{
          position: "absolute", bottom: 18, left: "50%", transform: "translateX(-50%)",
          color: "#888", fontFamily: "'Bebas Neue', sans-serif", fontSize: 11,
          letterSpacing: 3, textShadow: "0 1px 0 #000",
        }}>{label}</div>
      )}
    </div>
  );
}

export function Knob({ value = 0.5, onChange, label, min = 0, max = 1, accent = "#ff3b2f", size = 78 }) {
  const ref = useRef(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startV = useRef(0);
  const angle = -135 + ((value - min) / (max - min)) * 270;

  const onDown = (e) => {
    dragging.current = true;
    startY.current = e.clientY ?? e.touches?.[0].clientY ?? 0;
    startV.current = value;
    e.preventDefault();
  };
  useEffect(() => {
    const move = (e) => {
      if (!dragging.current) return;
      const y = e.clientY ?? e.touches?.[0]?.clientY ?? 0;
      const dy = startY.current - y;
      const range = max - min;
      const next = Math.max(min, Math.min(max, startV.current + (dy / 200) * range));
      onChange?.(next);
    };
    const up = () => { dragging.current = false; };
    window.addEventListener("mousemove", move);
    window.addEventListener("touchmove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchend", up);
    };
  }, [min, max, onChange]);

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div
        ref={ref}
        onMouseDown={onDown}
        onTouchStart={onDown}
        style={{
          width: size, height: size, borderRadius: "50%",
          background: `
            radial-gradient(circle at 50% 50%, #2a2b2e 0 35%, transparent 35%),
            conic-gradient(from 0deg, #1a1b1d, #4a4d52, #1a1b1d, #4a4d52, #1a1b1d, #4a4d52, #1a1b1d, #4a4d52, #1a1b1d)`,
          boxShadow: `
            inset 0 2px 0 rgba(255,255,255,0.25),
            inset 0 -3px 6px rgba(0,0,0,0.7),
            0 4px 8px rgba(0,0,0,0.55),
            0 1px 0 rgba(255,255,255,0.3)`,
          position: "relative",
          cursor: "ns-resize",
          userSelect: "none",
        }}
      >
        <div style={{
          position: "absolute", inset: 0,
          transform: `rotate(${angle}deg)`,
          transition: dragging.current ? "none" : "transform 0.15s",
        }}>
          <div style={{
            position: "absolute",
            top: 6, left: "50%", transform: "translateX(-50%)",
            width: 4, height: size * 0.28,
            background: accent,
            borderRadius: 2,
            boxShadow: `0 0 6px ${accent}, 0 0 12px ${accent}`,
          }} />
        </div>
        <div style={{
          position: "absolute", inset: "30%",
          borderRadius: "50%",
          background: `radial-gradient(circle at 35% 30%, #6c6e72 0%, #2a2c30 70%)`,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.3), inset 0 -2px 3px rgba(0,0,0,0.6)",
        }} />
      </div>
      {label && (
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif", letterSpacing: 2,
          fontSize: 10, color: "#222", textShadow: "0 1px 0 rgba(255,255,255,0.4)",
        }}>{label}</div>
      )}
    </div>
  );
}

export function TransportButton({ icon, label, onClick, active, danger, width = 64 }) {
  return (
    <button
      onClick={onClick}
      style={{
        width, height: 50,
        border: "none",
        borderRadius: 4,
        padding: 0,
        background: active
          ? `linear-gradient(180deg, #3a3c40 0%, #1a1b1d 100%)`
          : `linear-gradient(180deg, #2a2c30 0%, #0a0a0b 100%)`,
        boxShadow: active
          ? "inset 0 2px 6px rgba(0,0,0,0.9), 0 0 0 1px #000"
          : "inset 0 1px 0 rgba(255,255,255,0.15), inset 0 -2px 3px rgba(0,0,0,0.6), 0 2px 3px rgba(0,0,0,0.5), 0 0 0 1px #000",
        color: danger ? "#ff3b2f" : (active ? "#fff" : "#cdcfd2"),
        fontFamily: "'Bebas Neue', sans-serif",
        letterSpacing: 1.5, fontSize: 11,
        cursor: "pointer",
        display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        gap: 2,
        transform: active ? "translateY(1px)" : "none",
        transition: "transform 0.05s, background 0.1s",
      }}
    >
      <div style={{ fontSize: 16, lineHeight: 1 }}>{icon}</div>
      <div>{label}</div>
    </button>
  );
}

export function LED({ color = "#ff3b2f", on = true, size = 8, label }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
      <div style={{
        width: size, height: size, borderRadius: "50%",
        background: on ? color : "#3a2a2a",
        boxShadow: on
          ? `0 0 4px ${color}, 0 0 10px ${color}, inset 0 0 2px rgba(255,255,255,0.6)`
          : "inset 0 1px 2px rgba(0,0,0,0.7)",
      }} />
      {label && (
        <span style={{
          fontFamily: "'Bebas Neue', sans-serif", letterSpacing: 1.5,
          fontSize: 9, color: "#222",
        }}>{label}</span>
      )}
    </div>
  );
}

export function LCD({ children, style, scanlines = true }) {
  return (
    <div style={{
      background: `
        linear-gradient(180deg, #d4e8b8 0%, #b8d896 50%, #a8c886 100%)`,
      boxShadow: `
        inset 0 0 0 2px #2a3a14,
        inset 0 0 0 4px #6a8442,
        inset 0 3px 8px rgba(0,0,0,0.45),
        inset 0 -1px 0 rgba(255,255,255,0.3)`,
      borderRadius: 4,
      color: "#1a2a08",
      fontFamily: "'VT323', 'Share Tech Mono', monospace",
      position: "relative",
      overflow: "hidden",
      ...style,
    }}>
      {scanlines && (
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "repeating-linear-gradient(0deg, rgba(0,0,0,0.08) 0 1px, transparent 1px 3px)",
        }} />
      )}
      {children}
    </div>
  );
}

export function VUMeter({ level = 0, label = "L" }) {
  const segs = 18;
  const lit = Math.round(level * segs);
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      background: "#0a0a0b",
      padding: "8px 10px",
      borderRadius: 3,
      boxShadow: "inset 0 2px 6px rgba(0,0,0,0.9), 0 1px 0 rgba(255,255,255,0.2)",
      flex: 1,
    }}>
      <div style={{
        fontFamily: "'Bebas Neue', sans-serif", color: "#888",
        fontSize: 10, letterSpacing: 1, width: 10,
      }}>{label}</div>
      <div style={{ display: "flex", gap: 2, flex: 1 }}>
        {Array.from({ length: segs }).map((_, i) => {
          const on = i < lit;
          let color = "#2a4a1a";
          let onColor = "#4cff5a";
          if (i > segs * 0.65) { color = "#4a3a10"; onColor = "#ffb020"; }
          if (i > segs * 0.85) { color = "#4a1010"; onColor = "#ff3b2f"; }
          return (
            <div key={i} style={{
              flex: 1, height: 10,
              background: on ? onColor : color,
              boxShadow: on ? `0 0 4px ${onColor}` : "none",
              borderRadius: 1,
              transition: "background 0.05s",
            }} />
          );
        })}
      </div>
    </div>
  );
}

export function Cassette({ spinning, progress = 0, label }) {
  const rotation = spinning ? "spin 2s linear infinite" : "none";
  return (
    <div style={{
      background: `linear-gradient(180deg, #1a1b1d 0%, #2a2c30 50%, #1a1b1d 100%)`,
      borderRadius: 6,
      padding: 14,
      boxShadow: "inset 0 2px 6px rgba(0,0,0,0.8), 0 1px 0 rgba(255,255,255,0.15)",
      width: "100%",
      position: "relative",
    }}>
      <style>{`@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }`}</style>
      <div style={{
        display: "flex", justifyContent: "space-around", alignItems: "center",
        background: `
          linear-gradient(180deg, #d4d6d9, #a4a7ab),
          repeating-linear-gradient(90deg, rgba(0,0,0,0.06) 0 1px, transparent 1px 3px)`,
        backgroundBlendMode: "multiply",
        borderRadius: 4,
        padding: "16px 20px",
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -2px 3px rgba(0,0,0,0.3)",
        border: "1px solid #333",
      }}>
        {[0, 1].map((i) => (
          <div key={i} style={{
            width: 56, height: 56, borderRadius: "50%",
            background: `radial-gradient(circle at 50% 50%, #1a1b1d 0 10px, #2a2c30 10px 14px, #1a1b1d 14px)`,
            boxShadow: "inset 0 0 0 2px #4a4d52, 0 1px 2px rgba(0,0,0,0.6)",
            position: "relative",
            animation: rotation,
          }}>
            {Array.from({length: 6}).map((_,k) => (
              <div key={k} style={{
                position: "absolute", inset: 0,
                transform: `rotate(${k * 60}deg)`,
              }}>
                <div style={{
                  position: "absolute", left: "50%", top: "50%",
                  width: 6, height: 22,
                  background: "#0a0a0b",
                  transform: "translate(-50%, -50%)",
                  borderRadius: 1,
                }} />
              </div>
            ))}
          </div>
        ))}
      </div>
      <div style={{
        marginTop: 10,
        height: 4,
        background: "#0a0a0b",
        borderRadius: 2,
        overflow: "hidden",
        boxShadow: "inset 0 1px 2px rgba(0,0,0,0.8)",
      }}>
        <div style={{
          width: `${progress * 100}%`,
          height: "100%",
          background: "linear-gradient(90deg, #ffb020, #ff3b2f)",
          boxShadow: "0 0 6px #ffb020",
          transition: "width 0.2s",
        }} />
      </div>
      {label && (
        <div style={{
          marginTop: 6, textAlign: "center",
          fontFamily: "'VT323', monospace", fontSize: 14, color: "#ffb020",
          letterSpacing: 1,
        }}>{label}</div>
      )}
    </div>
  );
}

export function ChunkySwitch({ value, onChange, options, label }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{
        display: "flex",
        background: "#0a0a0b",
        padding: 3,
        borderRadius: 4,
        boxShadow: "inset 0 2px 4px rgba(0,0,0,0.9)",
      }}>
        {options.map((opt) => (
          <button key={opt}
            onClick={() => onChange(opt)}
            style={{
              border: "none",
              padding: "7px 14px",
              fontFamily: "'Bebas Neue', sans-serif",
              letterSpacing: 1.5, fontSize: 11,
              margin: "0 1px",
              cursor: "pointer",
              background: opt === value
                ? "linear-gradient(180deg, #d4d6d9, #8a8d92)"
                : "transparent",
              color: opt === value ? "#0a0a0b" : "#888",
              boxShadow: opt === value
                ? "inset 0 1px 0 rgba(255,255,255,0.5), 0 1px 2px rgba(0,0,0,0.6)"
                : "none",
              borderRadius: 2,
            }}
          >{opt}</button>
        ))}
      </div>
      {label && (
        <div style={{
          fontFamily: "'Bebas Neue', sans-serif", letterSpacing: 2,
          fontSize: 9, color: "#222",
        }}>{label}</div>
      )}
    </div>
  );
}
