/**
 * Tiny synthesized UI sounds for the voice assistant — no audio files.
 * Soft sine "glass" tones with a fast attack and exponential decay.
 */
let ctx: AudioContext | null = null;

function tone(freq: number, start: number, dur: number, gain: number) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  o.connect(g).connect(ctx.destination);
  o.start(start);
  o.stop(start + dur + 0.05);
}

function play(notes: [freq: number, at: number, dur: number][], gain = 0.06) {
  try {
    ctx ??= new AudioContext();
    void ctx.resume();
    const t = ctx.currentTime + 0.01;
    for (const [f, at, d] of notes) tone(f, t + at, d, gain);
  } catch {
    // Sound is decoration; never break the UI over it.
  }
}

export const sfx = {
  /** Assistant connected: rising fifth. */
  connect: () => play([[659.3, 0, 0.35], [987.8, 0.09, 0.5]]),
  /** Session ended: falling. */
  end: () => play([[987.8, 0, 0.3], [659.3, 0.08, 0.45]]),
  /** A frame landed on the face: airy sparkle. */
  drop: () => play([[1318.5, 0, 0.25], [1760, 0.05, 0.3], [2093, 0.1, 0.4]], 0.035),
  /** Liked. */
  like: () => play([[783.99, 0, 0.2], [1046.5, 0.07, 0.25], [1318.5, 0.14, 0.45]], 0.05),
};
