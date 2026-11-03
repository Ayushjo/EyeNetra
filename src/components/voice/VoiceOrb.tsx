"use client";

import { useEffect, useRef } from "react";
import { useVoiceStore, voiceLevels, type VoicePhase } from "@/store/voiceStore";

/**
 * The assistant's "face": a glowing glass orb rendered by a fragment shader.
 *
 *   off        dim, slow breathing
 *   connecting faster breathing, pale
 *   listening  calm teal, gentle swirl
 *   user       teal brightening + ripples driven by the customer's mic
 *   thinking   violet, fast inner swirl
 *   speaking   warm gold, surface wobbles with the bot's voice
 *
 * Levels come from voiceLevels (Web Audio RMS), read every animation frame
 * so the orb follows syllables without any React re-render.
 */

const VERT = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos; gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
varying vec2 vUv;
uniform float uTime;
uniform float uLevel;   // active audio level 0..1
uniform float uSwirl;   // inner flow speed
uniform float uRipple;  // ripple strength (customer speaking)
uniform vec3 uColA;
uniform vec3 uColB;
uniform vec3 uColRim;
uniform float uDim;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float noise(vec3 x) {
  vec3 i = floor(x), f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                 mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                 mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main() {
  vec2 uv = vUv;
  float r = length(uv);
  float ang = atan(uv.y, uv.x);
  float t = uTime;

  // Radius: breathing + audio, with a noisy wobble when loud.
  float breathe = 0.015 * sin(t * 1.6);
  float wob = (noise(vec3(cos(ang) * 1.6, sin(ang) * 1.6, t * 1.4)) - 0.5) * (0.04 + 0.16 * uLevel);
  float R = 0.56 + breathe + 0.07 * uLevel + wob;

  vec3 col = vec3(0.0);
  float alpha = 0.0;

  if (r < R) {
    float z = sqrt(max(R * R - r * r, 0.0));
    vec3 p = vec3(uv, z) / R;
    // Rotate slowly so the nebula drifts across the surface.
    float c = cos(t * 0.25 * uSwirl), s = sin(t * 0.25 * uSwirl);
    p.xz = mat2(c, -s, s, c) * p.xz;
    vec3 q = p * 1.7;
    float warp = fbm(q + vec3(0.0, t * 0.35 * uSwirl, 0.0));
    float n = fbm(q + 2.2 * vec3(warp, warp * 0.7, -warp) + vec3(t * 0.12 * uSwirl));
    vec3 body = mix(uColA, uColB, smoothstep(0.25, 0.8, n));
    // Bright filaments.
    float fil = smoothstep(0.62, 0.72, n) * (0.6 + 0.8 * uLevel);
    body += uColRim * fil;
    float fres = pow(1.0 - z / R, 2.2);
    // Glass: dark core shading, bright rim, a specular highlight.
    float shade = 0.55 + 0.45 * (z / R);
    vec2 hl = uv - vec2(-0.2, 0.24) * R;
    float spec = exp(-dot(hl, hl) / (0.018 * R)) * 0.55;
    col = body * shade + uColRim * fres * 1.2 + vec3(spec);
    float edge = smoothstep(R, R - 0.012, r);
    alpha = edge;
  }

  // Soft outer glow.
  float g = exp(-max(r - R, 0.0) * (9.0 - 4.0 * uLevel)) * (0.35 + 0.65 * uLevel);
  col += uColRim * g * (1.0 - alpha);
  alpha = max(alpha, g * 0.85);

  // Ripples while the customer speaks.
  if (uRipple > 0.001) {
    for (int k = 0; k < 3; k++) {
      float ph = fract(t * 0.7 + float(k) / 3.0);
      float rr = R + ph * 0.42;
      float ring = exp(-pow((r - rr) * 70.0, 2.0)) * (1.0 - ph) * uRipple;
      col += uColRim * ring;
      alpha = max(alpha, ring);
    }
  }

  col *= uDim;
  gl_FragColor = vec4(col * alpha, alpha);
}
`;

type Look = { a: number[]; b: number[]; rim: number[]; swirl: number; dim: number };

const LOOKS: Record<VoicePhase, Look> = {
  off:        { a: [0.10, 0.14, 0.22], b: [0.22, 0.30, 0.42], rim: [0.45, 0.60, 0.80], swirl: 0.5, dim: 0.75 },
  connecting: { a: [0.15, 0.22, 0.35], b: [0.40, 0.55, 0.75], rim: [0.65, 0.80, 1.00], swirl: 1.4, dim: 0.9 },
  listening:  { a: [0.02, 0.20, 0.28], b: [0.10, 0.60, 0.70], rim: [0.40, 0.95, 1.00], swirl: 0.8, dim: 1.0 },
  user:       { a: [0.03, 0.28, 0.30], b: [0.20, 0.85, 0.80], rim: [0.55, 1.00, 0.95], swirl: 1.1, dim: 1.1 },
  thinking:   { a: [0.12, 0.05, 0.30], b: [0.50, 0.30, 0.95], rim: [0.75, 0.60, 1.00], swirl: 3.2, dim: 1.05 },
  speaking:   { a: [0.30, 0.12, 0.03], b: [0.98, 0.62, 0.20], rim: [1.00, 0.85, 0.50], swirl: 1.3, dim: 1.1 },
  error:      { a: [0.30, 0.04, 0.06], b: [0.70, 0.15, 0.18], rim: [1.00, 0.45, 0.45], swirl: 0.6, dim: 0.9 },
};

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(s) ?? "shader compile failed");
  }
  return s;
}

export function VoiceOrb({ size = 120, className = "" }: { size?: number; className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, alpha: true, antialias: true });
    if (!gl) return;
    let prog: WebGLProgram;
    try {
      prog = gl.createProgram()!;
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link failed");
    } catch (e) {
      console.warn("[EyeNetra:orb] shader unavailable", e);
      return;
    }
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, "aPos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uTime = u("uTime"), uLevel = u("uLevel"), uSwirl = u("uSwirl"), uRipple = u("uRipple");
    const uColA = u("uColA"), uColB = u("uColB"), uColRim = u("uColRim"), uDim = u("uDim");

    // Current look, eased toward the target phase's look each frame.
    const cur: Look = structuredClone(LOOKS[useVoiceStore.getState().phase]);
    let level = 0, ripple = 0;
    const t0 = performance.now();
    let raf = 0;

    const draw = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const px = Math.round(canvas.clientWidth * dpr);
      if (canvas.width !== px || canvas.height !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);

      const phase = useVoiceStore.getState().phase;
      const tgt = LOOKS[phase];
      const k = 0.06;
      for (const key of ["a", "b", "rim"] as const) {
        for (let i = 0; i < 3; i++) cur[key][i] += (tgt[key][i] - cur[key][i]) * k;
      }
      cur.swirl += (tgt.swirl - cur.swirl) * k;
      cur.dim += (tgt.dim - cur.dim) * k;

      const want =
        phase === "speaking" ? voiceLevels.bot : phase === "user" || phase === "listening" ? voiceLevels.mic * 0.8 : 0.15;
      level += (want - level) * 0.35;
      ripple += ((phase === "user" ? 0.4 + voiceLevels.mic : 0) - ripple) * 0.1;

      gl.uniform1f(uTime, (performance.now() - t0) / 1000);
      gl.uniform1f(uLevel, Math.min(1, level));
      gl.uniform1f(uSwirl, cur.swirl);
      gl.uniform1f(uRipple, Math.min(1, ripple));
      gl.uniform3fv(uColA, cur.a);
      gl.uniform3fv(uColB, cur.b);
      gl.uniform3fv(uColRim, cur.rim);
      gl.uniform1f(uDim, cur.dim);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      // No loseContext(): React strict mode re-runs this effect on the same
      // canvas, and a lost context cannot be recreated.
      cancelAnimationFrame(raf);
      gl.deleteBuffer(buf);
      gl.deleteProgram(prog);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ width: size, height: size }}
      aria-hidden
    />
  );
}
