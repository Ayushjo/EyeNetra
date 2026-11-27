"use client";

import { useEffect, useId, useRef } from "react";
import { useVoiceStore, voiceLevels } from "@/store/voiceStore";

/**
 * आरव — the kiosk's on-screen optical consultant.
 *
 * A drawn (SVG) character, animated every frame without React re-renders:
 *   speaking  mouth opens with the bot's voice (Web Audio RMS), small head bob
 *   listening head tilts toward the customer, brows lift, nods while they talk
 *   thinking  eyes glance up, one brow raised
 *   idle      breathing, slow sway, natural blinks
 */

type Mood = "idle" | "listening" | "user" | "thinking" | "speaking";

function mouthPaths(open: number, smile: number) {
  // Corners, upper and lower lip control points around (180, 222).
  const w = 42 + smile * 8 - open * 8;
  const cy = 222 - smile * 5;
  const l = 180 - w / 2;
  const r = 180 + w / 2;
  const up = 219 - open * 3 + smile * 1;
  const lo = 229 + open * 24 + smile * 3;
  const outer = `M ${l} ${cy} Q ${180 - w / 4} ${up - 2} 180 ${up + 0.5} Q ${180 + w / 4} ${up - 2} ${r} ${cy} Q 180 ${lo + 3} ${l} ${cy} Z`;
  const ii = Math.max(0, open);
  const inner = `M ${l + 3} ${cy + 0.5} Q 180 ${up + 2 + ii * 2} ${r - 3} ${cy + 0.5} Q 180 ${lo - 1} ${l + 3} ${cy + 0.5} Z`;
  return { outer, inner, teethY: up + 1.5, open: ii };
}

export function Avatar({ className = "", mood: forced }: { className?: string; mood?: Mood }) {
  const uid = useId().replace(/:/g, "");
  const root = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = root.current;
    if (!svg) return;
    const q = <T extends SVGElement>(sel: string) => svg.querySelector<T>(`[data-k="${sel}"]`)!;
    const head = q<SVGGElement>("head");
    const body = q<SVGGElement>("body");
    const mouthOuter = q<SVGPathElement>("mouth-outer");
    const mouthInner = q<SVGPathElement>("mouth-inner");
    const teeth = q<SVGRectElement>("teeth");
    const lids = [q<SVGGElement>("lid-l"), q<SVGGElement>("lid-r")];
    const brows = [q<SVGPathElement>("brow-l"), q<SVGPathElement>("brow-r")];
    const pupils = [q<SVGGElement>("pupil-l"), q<SVGGElement>("pupil-r")];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    let open = 0;
    let tilt = 0;
    let brow = 0;
    let look = { x: 0, y: 0 };
    let nextBlink = performance.now() + 2000;
    let blinkT = -1;
    let jitter = 0;
    const t0 = performance.now();

    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      const phase = forced ?? (useVoiceStore.getState().phase as string);
      const mood: Mood =
        phase === "speaking" ? "speaking"
        : phase === "user" ? "user"
        : phase === "thinking" ? "thinking"
        : phase === "listening" ? "listening"
        : "idle";

      // Mouth: bot voice level with a little syllable texture.
      if (Math.random() < 0.18) jitter = Math.random();
      const lvl = mood === "speaking" ? voiceLevels.bot : 0;
      const target = mood === "speaking" ? Math.min(1, lvl * 1.35) * (0.75 + 0.25 * jitter) : 0;
      open += (target - open) * (target > open ? 0.55 : 0.25);
      const smile = mood === "speaking" ? 0.35 : mood === "idle" ? 0.75 : 0.55;
      const m = mouthPaths(open, smile);
      mouthOuter.setAttribute("d", m.outer);
      mouthInner.setAttribute("d", m.inner);
      mouthInner.style.opacity = String(Math.min(1, open * 3));
      teeth.setAttribute("y", String(m.teethY));
      teeth.style.opacity = String(Math.min(1, Math.max(0, open - 0.12) * 4));

      // Head: sway, tilt toward the customer while listening, nods while they talk.
      const tiltTarget = mood === "listening" || mood === "user" ? -4 : mood === "thinking" ? 3 : 0;
      tilt += (tiltTarget - tilt) * 0.05;
      const sway = reduce ? 0 : Math.sin(t * 0.6) * 1.2;
      const nod = mood === "user" ? Math.sin(t * 4.2) * 1.6 * Math.min(1, voiceLevels.mic * 2 + 0.3) : 0;
      const bob = mood === "speaking" ? open * 2.2 : 0;
      head.setAttribute("transform", `rotate(${(tilt + sway).toFixed(2)} 180 250) translate(0 ${(nod + bob).toFixed(2)})`);
      const breathe = reduce ? 0 : Math.sin(t * 1.4) * 0.8;
      body.setAttribute("transform", `translate(0 ${breathe.toFixed(2)})`);

      // Brows + gaze.
      const browTarget = mood === "listening" || mood === "user" ? 1 : mood === "thinking" ? 1.6 : mood === "speaking" ? 0.4 + open * 0.8 : 0;
      brow += (browTarget - brow) * 0.08;
      brows[0].setAttribute("transform", `translate(0 ${(-brow * 2.4).toFixed(2)})`);
      brows[1].setAttribute("transform", `translate(0 ${(-brow * (mood === "thinking" ? 4 : 2.4)).toFixed(2)})`);
      const lookTarget = mood === "thinking" ? { x: 3, y: -3.5 } : { x: Math.sin(t * 0.37) * 0.8, y: 0 };
      look = { x: look.x + (lookTarget.x - look.x) * 0.06, y: look.y + (lookTarget.y - look.y) * 0.06 };
      for (const p of pupils) p.setAttribute("transform", `translate(${look.x.toFixed(2)} ${look.y.toFixed(2)})`);

      // Blinks: every 2.5–6 s, 140 ms.
      if (blinkT < 0 && now > nextBlink) blinkT = now;
      let lid = 0;
      if (blinkT >= 0) {
        const k = (now - blinkT) / 140;
        lid = k < 0.5 ? k * 2 : 2 - k * 2;
        if (k >= 1) {
          blinkT = -1;
          lid = 0;
          nextBlink = now + 2500 + Math.random() * 3500;
        }
      }
      for (const l of lids) l.setAttribute("transform", `translate(0 ${(-12 + lid * 12).toFixed(2)})`);

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [forced]);

  const id = (n: string) => `${uid}-${n}`;
  return (
    <svg ref={root} viewBox="0 0 360 420" className={className} role="img" aria-label="आरव, KG Optic के सहायक">
      <defs>
        <radialGradient id={id("skin")} cx="45%" cy="38%" r="70%">
          <stop offset="0" stopColor="#DDA57F" />
          <stop offset="0.65" stopColor="#C88D66" />
          <stop offset="1" stopColor="#A9724F" />
        </radialGradient>
        <linearGradient id={id("neck")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#9A6545" />
          <stop offset="0.5" stopColor="#B57B57" />
        </linearGradient>
        <linearGradient id={id("hair")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2B231E" />
          <stop offset="1" stopColor="#14100D" />
        </linearGradient>
        <linearGradient id={id("blazer")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#2B3A52" />
          <stop offset="1" stopColor="#1A2434" />
        </linearGradient>
        <linearGradient id={id("lens")} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.32" />
          <stop offset="0.45" stopColor="#ffffff" stopOpacity="0.04" />
          <stop offset="1" stopColor="#ffffff" stopOpacity="0.14" />
        </linearGradient>
        <clipPath id={id("eye-l")}>
          <ellipse cx="151" cy="166" rx="11.5" ry="7.6" />
        </clipPath>
        <clipPath id={id("eye-r")}>
          <ellipse cx="209" cy="166" rx="11.5" ry="7.6" />
        </clipPath>
        <clipPath id={id("mouth")}>
          <path data-k="mouth-clip" d="M 150 215 L 210 215 L 210 260 L 150 260 Z" />
        </clipPath>
      </defs>

      <g data-k="body">
        {/* Torso: blazer, shirt, lapels, brass pin */}
        <path d="M 30 420 C 36 340 78 300 140 290 L 220 290 C 282 300 324 340 330 420 Z" fill={`url(#${id("blazer")})`} />
        <path d="M 150 290 L 180 352 L 210 290 Z" fill="#F3EFE7" />
        <path d="M 160 290 L 180 330 L 200 290 L 192 286 L 180 300 L 168 286 Z" fill="#E4DED2" />
        <path d="M 140 291 L 180 360 L 150 420 L 112 420 L 128 340 Z" fill="#33445F" opacity="0.9" />
        <path d="M 220 291 L 180 360 L 210 420 L 248 420 L 232 340 Z" fill="#33445F" opacity="0.9" />
        <path d="M 176 336 L 184 336 L 186 360 L 180 372 L 174 360 Z" fill="#7A2E2A" />
        <circle cx="236" cy="344" r="5.5" fill="#B08D57" />
        <circle cx="236" cy="344" r="2.4" fill="#E6CD99" />
      </g>

      <g data-k="head">
        {/* Neck */}
        <path d="M 150 232 L 148 292 Q 180 308 212 292 L 210 232 Z" fill={`url(#${id("neck")})`} />
        {/* Ears */}
        <ellipse cx="108" cy="172" rx="12" ry="20" fill="#B97E59" />
        <ellipse cx="252" cy="172" rx="12" ry="20" fill="#B97E59" />
        <path d="M 104 164 Q 110 172 106 182" stroke="#93603F" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        <path d="M 256 164 Q 250 172 254 182" stroke="#93603F" strokeWidth="2.4" fill="none" strokeLinecap="round" />
        {/* Face */}
        <path
          d="M 112 150 C 112 96 142 72 180 72 C 218 72 248 96 248 150 C 248 196 236 228 212 248 C 198 260 162 260 148 248 C 124 228 112 196 112 150 Z"
          fill={`url(#${id("skin")})`}
        />
        {/* Jaw shading */}
        <path d="M 124 206 C 136 236 156 252 180 254 C 204 252 224 236 236 206 C 224 228 204 244 180 245 C 156 244 136 228 124 206 Z" fill="#8F5E40" opacity="0.18" />
        {/* Hair: side-swept with volume, short sideburns */}
        <path
          d="M 110 160 C 104 120 112 84 142 66 C 168 50 214 50 236 70 C 254 86 258 118 252 160 C 250 134 244 116 232 106 C 212 98 182 98 156 104 C 140 106 128 118 120 132 C 116 140 113 150 110 160 Z"
          fill={`url(#${id("hair")})`}
        />
        <path d="M 112 150 C 112 160 113 168 116 176 L 120 176 C 118 166 118 156 120 146 Z" fill="#1E1814" />
        <path d="M 248 150 C 248 160 247 168 244 176 L 240 176 C 242 166 242 156 240 146 Z" fill="#1E1814" />
        <path d="M 150 72 C 176 60 214 64 232 84" stroke="#4A3D35" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.55" />
        <path d="M 138 92 C 160 78 196 78 222 96" stroke="#3A302A" strokeWidth="2" fill="none" strokeLinecap="round" opacity="0.6" />
        <path d="M 124 120 C 140 98 172 92 200 98" stroke="#0D0A08" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.45" />
        {/* Cheeks + smile lines */}
        <ellipse cx="136" cy="202" rx="14" ry="8" fill="#C96F5A" opacity="0.18" />
        <ellipse cx="224" cy="202" rx="14" ry="8" fill="#C96F5A" opacity="0.18" />
        {/* Brows */}
        <path data-k="brow-l" d="M 134 146 Q 150 138 166 145" stroke="#1E1814" strokeWidth="5.5" fill="none" strokeLinecap="round" />
        <path data-k="brow-r" d="M 194 145 Q 210 138 226 146" stroke="#1E1814" strokeWidth="5.5" fill="none" strokeLinecap="round" />
        {/* Eyes */}
        {(["l", "r"] as const).map((s) => {
          const cx = s === "l" ? 151 : 209;
          return (
            <g key={s}>
              <ellipse cx={cx} cy="166" rx="11.5" ry="7.6" fill="#FBF8F3" />
              <g clipPath={`url(#${id(`eye-${s}`)})`}>
                <g data-k={`pupil-${s}`}>
                  <circle cx={cx} cy="166.5" r="6.4" fill="#4A2C1A" />
                  <circle cx={cx} cy="166.5" r="3.4" fill="#120A06" />
                  <circle cx={cx + 2.2} cy="164" r="1.7" fill="#fff" opacity="0.9" />
                </g>
                <g data-k={`lid-${s}`} transform="translate(0 -12)">
                  <rect x={cx - 13} y="146" width="26" height="14" fill="#B47A56" />
                </g>
              </g>
              <path d={`M ${cx - 12} 164 Q ${cx} 156 ${cx + 12} 164`} stroke="#3A2A20" strokeWidth="1.8" fill="none" strokeLinecap="round" />
            </g>
          );
        })}
        {/* Nose */}
        <path d="M 182 166 C 184 182 190 192 188 198 C 186 203 178 204 172 201" stroke="#8F5C3D" strokeWidth="2.6" fill="none" strokeLinecap="round" opacity="0.75" />
        <path d="M 168 198 Q 172 203 177 201" stroke="#8F5C3D" strokeWidth="2" fill="none" opacity="0.5" />
        {/* Mouth */}
        <path data-k="mouth-outer" d="M 159 222 Q 180 216 201 222 Q 180 234 159 222 Z" fill="#A4543F" />
        <g clipPath={`url(#${id("mouth")})`}>
          <path data-k="mouth-inner" d="" fill="#3B1712" />
          <rect data-k="teeth" x="166" y="219" width="28" height="5.5" rx="2" fill="#F4EFE6" opacity="0" />
        </g>
        {/* Glasses: thin brass rectangles (he is an optician) */}
        <g fill="none" stroke="#9C7640" strokeWidth="3.2" strokeLinejoin="round">
          <rect x="125" y="149" width="52" height="36" rx="11" fill={`url(#${id("lens")})`} />
          <rect x="183" y="149" width="52" height="36" rx="11" fill={`url(#${id("lens")})`} />
          <path d="M 177 162 Q 180 158 183 162" />
          <path d="M 125 158 L 112 155" />
          <path d="M 235 158 L 248 155" />
        </g>
        <path d="M 131 154 L 141 154" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
        <path d="M 189 154 L 199 154" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity="0.55" />
      </g>
    </svg>
  );
}
