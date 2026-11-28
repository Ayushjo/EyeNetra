"use client";

import { Canvas, useThree } from "@react-three/fiber";
import { Environment, useGLTF } from "@react-three/drei";
import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ACESFilmicToneMapping,
  Box3,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  SRGBColorSpace,
  Vector3,
  type Material,
} from "three";
import { FRAMES, type FrameSku, type FrameVariant } from "@/data/frames";
import { applyVariant, isLensName, normalizeGlasses } from "@/components/GlassesModel";
import { FrameGlyph } from "@/components/voice/FrameGlyph";
import { formatRupees, SHAPE_LABEL } from "@/components/voice/VoiceStageOverlay";
import { SHOP_HDRI } from "@/lib/hdri";
import { useTryOnStore } from "@/store/tryOnStore";
import { useVoiceStore } from "@/store/voiceStore";

/*
 * The frame dial on the right edge of the mirror (the customer stands left).
 * A big ring runs off the right edge; frames sit on its rim with the one on
 * the face at the left-most point, its neighbours above and below. The three
 * nearest are the actual 3D frames — still, in three-quarter view from a little above,
 * no boxes — drawn on a small transparent canvas. Each frame sits ON the
 * ring line, centred on it, with its name to its right (white outlined
 * text). The
 * colours of the frame on the face sit on a smaller inner ring, each named.
 * Drag up/down, scroll, or tap a frame to turn the dial; the assistant turns
 * it too.
 */

const N = FRAMES.length;
/** Angle between neighbouring frames on the ring (~22°: five fit on screen). */
const STEP = 0.39;
/**
 * Three-quarter view, facing left and seen from a little above: the frame
 * turned ~34° so its front looks toward the mirror's centre and its arms run
 * back to the right (toward its label), then tipped ~20° so the top of the
 * frame and the arms show — a product-shot angle.
 */
const YAW = -0.6;
const PITCH = 0.35;
/** Gap between a frame and its name (px). */
const LABEL_GAP = 10;
// ===== Disc size & look — tune here ========================================
/**
 * Layout radius as a fraction of the mirror's height: where the frames,
 * selection box and colours go. Change DISC_DRAW to resize only the circle.
 */
const DISC_RADIUS = 0.68;
/** Size of the drawn circle only (× layout radius) — nothing else moves. */
const DISC_DRAW = 0.88;
/** How far the disc's centre sits beyond the panel's right edge (× radius). */
const CENTRE_OUT = 0.22;
/** Inner (colour) track radius (× disc radius). */
const INNER = 0.38;
/**
 * Frosted glass, baked into two transparent images (scripts/make-wheel-frost.py):
 * a faint haze over the whole disc, and a milky band fading in toward the
 * rim. These replaced two live backdrop blurs of the camera picture, which
 * the GPU had to redo for every video frame and which slowed face tracking.
 */
const FROST_CENTRE_SRC = "/images/wheel-frost-centre.png";
const FROST_RIM_SRC = "/images/wheel-frost-rim.png";
/**
 * Shadow under frames on the dark disc: "light" (white glow, crossfading to
 * black inside the selection box) or "dark" (black everywhere).
 */
const DISC_SHADOW_TONE: "light" | "dark" = "dark";
/** Dark tint: alpha at the centre and at the rim. */
const TINT_CENTRE = 0.6;
const TINT_RIM = 0.38;
// ============================================================================
/** Selection box: inner padding, name/details width, gap to the colours (px). */
const BOX_PAD = 12;
const BOX_LABEL_W = 132;
const BOX_COLOUR_GAP = 20;
/** The selected frame + box pull left of the ring (px) and grow (× size). */
const SELECT_SHIFT = 40;
const SELECT_GROW = 0.12;
/** Angle between neighbouring colours on the inner ring. */
const COLOUR_STEP = 0.5;
const mod = (i: number, n: number) => ((i % n) + n) % n;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Line-drawing shape for a catalogue frame (FrameGlyph), from its id/name. */
function shapeOf(f: FrameSku): string {
  const s = `${f.id} ${f.name}`.toLowerCase();
  if (/aviator|pilot/.test(s)) return "aviator";
  if (/cat/.test(s)) return "cat-eye";
  if (/round|panto/.test(s)) return "round";
  if (/oval/.test(s)) return "oval";
  if (/square|wayfarer|sport|hexagon|shield|oversize/.test(s)) return "square";
  return "rectangular";
}

/** One frame's 3D preview failing to load must not take the dial (or page) down. */
class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    console.warn("[EyeNetra:wheel] 3D preview failed", err);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type Layout = {
  W: number;
  H: number;
  /** Disc radius. */
  R: number;
  /** Radius the frames sit on (inside the disc, near its edge). */
  Ri: number;
  /** Colour track radius. */
  r: number;
  cx: number;
  cy: number;
  frameW: number;
  /** Name/details width: fits between a frame and the colours. */
  labelW: number;
  /** The selection box (fixed at the disc's left-most point). */
  box: { x: number; y: number; w: number; h: number };
};

function computeLayout(W: number, H: number): Layout {
  /** Width of the selected frame (the others are smaller). */
  const frameW = Math.min(104, W * 0.26);
  // A big disc: runs off the top and bottom, its left-most edge inside the panel.
  const R = Math.max(160, Math.min(H * DISC_RADIUS, (W - 8) / (1 - CENTRE_OUT)));
  const cx = W + R * CENTRE_OUT;
  const cy = H / 2;
  const r = R * INNER;
  // The selection box may stick out past the disc's left edge, but its right
  // edge always stays clear of the middle colour (18 px radius) and it never
  // leaves the panel: on a narrow mirror its text column narrows instead.
  const boxRight = cx - r - 18 - BOX_COLOUR_GAP;
  const fixedW = BOX_PAD + frameW + LABEL_GAP + BOX_PAD;
  const labelW = Math.max(72, Math.min(BOX_LABEL_W, boxRight - 4 - fixedW));
  const boxW = fixedW + labelW;
  const boxH = Math.max(84, frameW * 0.62 + BOX_PAD * 2);
  const boxX = boxRight - boxW;
  // Frames turn on the circle through the selected frame's spot in the box.
  const Ri = cx - (boxX + BOX_PAD + frameW / 2);
  return {
    W,
    H,
    R,
    Ri,
    r,
    cx,
    cy,
    frameW,
    labelW,
    box: { x: boxX, y: cy - boxH / 2, w: boxW, h: boxH },
  };
}

/** Point on a ring; theta 0 = left-most point, positive = downward. */
function onRing(L: Layout, radius: number, theta: number) {
  return { x: L.cx - radius * Math.cos(theta), y: L.cy + radius * Math.sin(theta) };
}

type Slot = {
  /** Unwrapped position on the dial (stable React key while it turns). */
  idx: number;
  frame: FrameSku;
  /** Point on the outer ring (panel px): the frame is centred here, its name to the right. */
  x: number;
  y: number;
  /** Frame width (px). */
  w: number;
  /** 0..1 — the 3D frame, for the three nearest. */
  model: number;
  /** 0..1 — line drawing, for the outer ones. */
  glyph: number;
  opacity: number;
  centre: boolean;
  /** 0..1: how much this frame is the selected one (its box fades with it). */
  sel: number;
};

function slotsAt(L: Layout, pos: number): Slot[] {
  const out: Slot[] = [];
  const base = Math.round(pos);
  for (let j = -3; j <= 3; j++) {
    const idx = base + j;
    const d = idx - pos;
    const ad = Math.abs(d);
    if (ad > 2.6) continue;
    const { x, y } = onRing(L, L.Ri, d * STEP);
    const sel = clamp01(1 - ad / 0.55);
    out.push({
      idx,
      frame: FRAMES[mod(idx, N)],
      // The selected frame steps out: a little left of the ring, a little bigger.
      x: x - SELECT_SHIFT * sel,
      y,
      w: L.frameW * (1 - 0.16 * Math.min(ad, 2)) * (1 + SELECT_GROW * sel),
      // All five on screen are 3D; only frames turning in/out past them
      // fall back to the line drawing.
      model: clamp01((2.6 - ad) / 0.3),
      glyph: clamp01((ad - 2.3) / 0.3),
      opacity: 1 - 0.35 * Math.max(0, ad - 1),
      centre: ad < 0.5,
      sel,
    });
  }
  return out;
}

/** The same frame finish as on the face (variant colour, lens tint), product-shot quality. */
function previewMaterial(m: Material, meshName: string, frame: FrameSku, variant: FrameVariant): Material {
  const lens = frame.fit.lensMaterialNames
    ? frame.fit.lensMaterialNames.includes(m.name)
    : isLensName(m.name || meshName);
  const keepTransparent = !lens && m.transparent && /transparent|pad|nose/i.test(m.name || meshName);
  const keepAuthored = !lens && Boolean(m.userData?.keepAuthored);
  let next: MeshStandardMaterial | MeshPhysicalMaterial;
  if (lens) {
    next = new MeshPhysicalMaterial();
    if (m instanceof MeshStandardMaterial) {
      next.map = m.map;
      next.normalMap = m.normalMap;
    }
  } else if (m instanceof MeshStandardMaterial) next = m.clone();
  else if (m instanceof MeshBasicMaterial) next = new MeshStandardMaterial({ color: m.color.clone() });
  else next = new MeshStandardMaterial();
  next.name = m.name;
  if (keepAuthored) {
    next.side = DoubleSide;
    next.envMapIntensity = 1.1;
  } else if (!keepTransparent) applyVariant(next, lens, variant, true, "capture");
  return next;
}

/** A frame for the dial: own materials, three-quarter view, centred, 1 unit wide as seen. */
function PreviewModel({
  frame,
  variant,
  x,
  y,
  width,
}: {
  frame: FrameSku;
  variant: FrameVariant;
  x: number;
  y: number;
  width: number;
}) {
  const { scene } = useGLTF(frame.glbPath);
  const object = useMemo(() => {
    const inner = scene.clone(true) as Group;
    inner.traverse((obj) => {
      if (!(obj instanceof Mesh)) return;
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      const next = mats.map((m: Material) => previewMaterial(m, obj.name, frame, variant));
      obj.material = Array.isArray(obj.material) ? next : next[0];
    });
    // Lenses face +Z (the camera), temples run back in −Z, then turn it.
    normalizeGlasses(inner, frame.fit);
    const turned = new Group();
    turned.add(inner);
    // Euler XYZ: turned about the vertical first, then tipped about the
    // screen's horizontal axis (camera slightly above).
    turned.rotation.set(PITCH, YAW, 0);
    const outer = new Group();
    outer.add(turned);
    outer.updateMatrixWorld(true);
    // Fit what the camera sees (front + arms after the turn): centred,
    // exactly 1 unit wide, so every frame fills its slot the same way.
    const box = new Box3().setFromObject(outer);
    const size = box.getSize(new Vector3());
    turned.position.sub(box.getCenter(new Vector3()));
    outer.scale.setScalar(1 / Math.max(size.x, 1e-4));
    return outer;
  }, [scene, frame, variant]);

  useEffect(
    () => () =>
      object.traverse((obj) => {
        if (!(obj instanceof Mesh)) return;
        (Array.isArray(obj.material) ? obj.material : [obj.material]).forEach((m: Material) => m.dispose());
      }),
    [object],
  );

  return (
    <group position={[x, y, 0]} scale={width}>
      <primitive object={object} />
    </group>
  );
}

/** Hands the canvas's invalidate to the dial, so a turn renders frame by frame. */
function InvalidateBridge({ invalidateRef }: { invalidateRef: React.MutableRefObject<(() => void) | null> }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidateRef.current = () => invalidate();
    return () => {
      invalidateRef.current = null;
    };
  }, [invalidate, invalidateRef]);
  return null;
}

/**
 * The 3D frames. Rendered on demand only — when the dial turns, a frame or
 * colour changes, or a model finishes loading — so a still dial costs nothing.
 */
function PreviewCanvas({
  L,
  slots,
  selectedFrameId,
  selectedVariantId,
  invalidateRef,
}: {
  L: Layout;
  slots: Slot[];
  selectedFrameId: string;
  selectedVariantId: string;
  invalidateRef: React.MutableRefObject<(() => void) | null>;
}) {
  return (
    <Canvas
      orthographic
      frameloop="demand"
      dpr={[1, 1.25]}
      camera={{ zoom: 1, position: [0, 0, 600], near: 1, far: 2000 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      onCreated={({ gl }) => {
        gl.outputColorSpace = SRGBColorSpace;
        gl.toneMapping = ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        gl.setClearColor(0x000000, 0);
      }}
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <InvalidateBridge invalidateRef={invalidateRef} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[200, 300, 500]} intensity={1.3} />
      <Suspense fallback={null}>
        <Environment files={SHOP_HDRI} background={false} />
      </Suspense>
      {slots
        .filter((s) => s.model > 0)
        .map((s) => {
          // The frame on the face in its chosen colour; the others in their first.
          const variant =
            (s.frame.id === selectedFrameId && s.frame.variants.find((v) => v.id === selectedVariantId)) ||
            s.frame.variants[0];
          return (
            <PreviewBoundary key={s.idx}>
              <Suspense fallback={null}>
                <PreviewModel
                  frame={s.frame}
                  variant={variant}
                  // Centred on the ring line. Canvas pixels → orthographic
                  // world units (origin at the centre, y up).
                  x={s.x - L.W / 2}
                  y={L.H / 2 - s.y}
                  width={s.w * s.model}
                />
              </Suspense>
            </PreviewBoundary>
          );
        })}
    </Canvas>
  );
}

/**
 * Colour slide-in: a pause first (the dial mostly settles on the new frame,
 * then its colours follow), then per-colour duration, stagger, and how far
 * along the ring each comes from.
 */
const COLOUR_DELAY_MS = 250;
const COLOUR_SLIDE_MS = 380;
/** The previous frame's colours leave within the pause (per colour, staggered). */
const COLOUR_EXIT_MS = 240;
const COLOUR_STAGGER_MS = 70;
const COLOUR_SLIDE_RAD = 0.6;

/**
 * Colours of the frame on the face, on the inner ring, each named. When the
 * frame changes, the new colours wait a moment, then slide in along the ring
 * from the side the dial turned from (next frame → from below), staggered,
 * fading in; meanwhile the previous frame's colours slide on out the other
 * side (next frame → up and away), fading out. Own
 * component + own animation state: the dial and its 3D canvas don't
 * re-render while the colours move.
 */
function ColourRing({
  L,
  frameId,
  frameIdx,
  variants,
  currentId,
  onPick,
}: {
  L: Layout;
  frameId: string;
  frameIdx: number;
  variants: FrameVariant[];
  currentId: string;
  onPick: (variantId: string) => void;
}) {
  type Shown = { frameId: string; variants: FrameVariant[]; currentId: string };
  /** A set sliding in: the side it comes from, start time, how many colours. */
  type Enter = { dir: number; t0: number; n: number };
  /**
   * A set sliding out, from wherever each colour was when it started leaving
   * (it may still have been on its way in): start opacity + ring offset.
   */
  type Leaving = Shown & { dir: number; t0: number; op0: number[]; off0: number[] };

  const prevIdx = useRef(frameIdx);
  /** What was on the ring before this render (the set that leaves on a frame change). */
  const shownRef = useRef<Shown>({ frameId, variants, currentId });
  const enterRef = useRef<Enter | null>(null);
  const leavingRef = useRef<Leaving[]>([]);
  /** Animation clock (performance.now), ticking only while something moves. */
  const [now, setNow] = useState(0);
  const rafRef = useRef(0);

  const enterEnd = (e: Enter) => e.t0 + COLOUR_DELAY_MS + COLOUR_SLIDE_MS + COLOUR_STAGGER_MS * Math.max(0, e.n - 1);
  const leaveEnd = (l: Leaving) => l.t0 + COLOUR_EXIT_MS + COLOUR_STAGGER_MS * Math.max(0, l.variants.length - 1);
  /** Entering colour i at time t: 0..1 progress (eased). */
  const enterEased = (e: Enter, i: number, t: number) => {
    const local = clamp01((t - e.t0 - COLOUR_DELAY_MS - i * COLOUR_STAGGER_MS) / COLOUR_SLIDE_MS);
    return 1 - Math.pow(1 - local, 3);
  };

  // Declared before the effect that records what is shown, so it still sees
  // the previous frame's colours here.
  useEffect(() => {
    const from = prevIdx.current;
    prevIdx.current = frameIdx;
    if (from === frameIdx) return;
    const t0 = performance.now();
    // Shortest way round the dial decides the side the colours come from.
    let d = mod(frameIdx - from, N);
    if (d > N / 2) d -= N;
    const dir = d >= 0 ? 1 : -1;

    // The set on the ring leaves from where it is right now — fully in place,
    // or part-way in after a quick second turn.
    const old = shownRef.current;
    const enter = enterRef.current;
    const op0 = old.variants.map((_, i) => (enter ? enterEased(enter, i, t0) : 1));
    const off0 = old.variants.map((_, i) => (enter ? enter.dir * COLOUR_SLIDE_RAD * (1 - op0[i]) : 0));
    leavingRef.current = [
      ...leavingRef.current.filter((l) => leaveEnd(l) > t0),
      ...(old.variants.length > 1 && op0.some((o) => o > 0.02) ? [{ ...old, dir, t0, op0, off0 }] : []),
    ];
    enterRef.current = { dir, t0, n: variants.length };
    setNow(t0);

    if (!rafRef.current) {
      const tick = (t: number) => {
        setNow(t);
        const e = enterRef.current;
        const busy = (e && t < enterEnd(e)) || leavingRef.current.some((l) => t < leaveEnd(l));
        if (!busy) {
          enterRef.current = null;
          leavingRef.current = [];
          rafRef.current = 0;
          return;
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    }
    // Only a frame change starts the slide (variants follow the frame).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameId]);
  useEffect(() => {
    shownRef.current = { frameId, variants, currentId };
  }, [frameId, variants, currentId]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const baseTheta = (i: number, n: number) => (i - (n - 1) / 2) * COLOUR_STEP;

  const swatch = (
    v: FrameVariant,
    key: string,
    theta: number,
    opacity: number,
    active: boolean,
    interactive: boolean,
  ) => {
    const { x, y } = onRing(L, L.r, theta);
    return (
      <button
        key={key}
        type="button"
        onClick={interactive ? () => onPick(v.id) : undefined}
        tabIndex={interactive ? undefined : -1}
        aria-hidden={interactive ? undefined : true}
        aria-pressed={interactive ? active : undefined}
        className={`absolute flex -translate-x-1/2 flex-col items-center gap-1 ${interactive ? "pointer-events-auto" : "pointer-events-none"}`}
        style={{ left: x, top: y - 18, opacity }}
      >
        <span
          // The selected colour's white ring is drawn separately (it glides
          // between colours); leaving sets keep a static one.
          className={`block h-9 w-9 rounded-full shadow-[0_2px_8px_rgba(0,0,0,0.35)] transition active:scale-90 ${
            !interactive && active ? "ring-[3px] ring-white" : "ring-2 ring-white/40 hover:ring-white/70"
          }`}
          style={{ backgroundColor: v.frameColor }}
        />
        <span
          className={`whitespace-nowrap text-[11px] leading-none ${
            active ? "font-semibold text-white" : "font-medium text-white/70"
          }`}
        >
          {v.name}
        </span>
      </button>
    );
  };

  const enter = enterRef.current;
  return (
    <>
      {/* Previous frames' colours slide on, out the far side, fading. */}
      {leavingRef.current.map((l) =>
        l.variants.map((v, i) => {
          const local = clamp01((now - l.t0 - i * COLOUR_STAGGER_MS) / COLOUR_EXIT_MS);
          if (local >= 1 || l.op0[i] <= 0.02) return null;
          const eased = local * local; // ease-in: leaves gently, then goes
          return swatch(
            v,
            `${l.frameId}-${l.t0}-${v.id}-out`,
            baseTheta(i, l.variants.length) + l.off0[i] - l.dir * COLOUR_SLIDE_RAD * eased,
            l.op0[i] * (1 - eased),
            v.id === l.currentId,
            false,
          );
        }),
      )}
      {/* The new frame's colours: a pause, then in from the side the dial turned from. */}
      {variants.length > 1
        ? variants.map((v, i) => {
            let theta = baseTheta(i, variants.length);
            let opacity = 1;
            if (enter) {
              const eased = enterEased(enter, i, now);
              theta += enter.dir * COLOUR_SLIDE_RAD * (1 - eased);
              opacity = eased;
            }
            return swatch(v, `${frameId}-${v.id}`, theta, opacity, v.id === currentId, true);
          })
        : null}
      {/* The selected colour's white ring: glides to a newly picked colour;
          on a frame change it rides in with its colour. */}
      {(() => {
        const ai = variants.findIndex((v) => v.id === currentId);
        if (variants.length < 2 || ai < 0) return null;
        let theta = baseTheta(ai, variants.length);
        let opacity = 1;
        if (enter) {
          const eased = enterEased(enter, ai, now);
          theta += enter.dir * COLOUR_SLIDE_RAD * (1 - eased);
          opacity = eased;
        }
        const { x, y } = onRing(L, L.r, theta);
        const glide = "320ms cubic-bezier(0.2, 0.8, 0.2, 1)";
        return (
          <span
            key={`ring-${frameId}`}
            className="pointer-events-none absolute h-11 w-11 rounded-full border-[3px] border-white shadow-[0_0_14px_rgba(255,255,255,0.35)]"
            style={{
              left: x - 22,
              top: y - 22,
              opacity,
              transition: enter ? "none" : `left ${glide}, top ${glide}`,
            }}
            aria-hidden
          />
        );
      })()}
    </>
  );
}

const HEART =
  "M12 21s-7.5-4.9-9.8-9.2C.6 8.6 2.4 5.4 5.6 5.4c1.9 0 3.4 1 4.3 2.5L12 10.6l2.1-2.7c.9-1.5 2.4-2.5 4.3-2.5 3.2 0 5 3.2 3.4 6.4C19.5 16.1 12 21 12 21Z";

export function FrameWheel() {
  const boxRef = useRef<HTMLDivElement>(null);
  const discRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ W: 0, H: 0 });
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ W: el.clientWidth, H: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedFrameId = useTryOnStore((s) => s.selectedFrameId);
  const selectedVariantId = useTryOnStore((s) => s.selectedVariantId);
  const setFrame = useTryOnStore((s) => s.setFrame);
  const setVariant = useTryOnStore((s) => s.setVariant);
  const frame = useTryOnStore((s) => s.selectedFrame());
  const selIdx = Math.max(0, FRAMES.findIndex((f) => f.id === selectedFrameId));

  // Frames the assistant showed / the customer liked this visit.
  const suggestions = useVoiceStore((s) => s.suggestions);
  const picks = useVoiceStore((s) => s.picks);
  const liked = useMemo(
    () => new Set(suggestions.filter((s) => picks.includes(s.sku)).map((s) => s.frameId)),
    [suggestions, picks],
  );
  // The product the assistant put on the face, when the dial's frame is its 3D stand-in.
  const activeSku = useVoiceStore((s) => s.activeSku);
  const product = useMemo(() => {
    const onFace = suggestions.filter((x) => x.frameId === selectedFrameId);
    return onFace.find((x) => x.sku === activeSku) ?? onFace[onFace.length - 1] ?? null;
  }, [suggestions, activeSku, selectedFrameId]);

  // Dial position (unwrapped frame index, fractional while turning).
  const posRef = useRef(selIdx);
  const targetRef = useRef(selIdx);
  const [pos, setPos] = useState(selIdx);
  const rafRef = useRef(0);
  const invalidateRef = useRef<(() => void) | null>(null);
  const draggingRef = useRef(false);

  const animate = useCallback(() => {
    if (rafRef.current) return;
    let last = performance.now();
    const step = (now: number) => {
      const dt = now - last;
      last = now;
      const p = posRef.current;
      const t = targetRef.current;
      const next = Math.abs(t - p) < 0.002 ? t : p + (t - p) * (1 - Math.exp(-dt / 90));
      posRef.current = next;
      setPos(next);
      invalidateRef.current?.();
      rafRef.current = next !== t && !draggingRef.current ? requestAnimationFrame(step) : 0;
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  /** Turn to an (unwrapped) dial position and put that frame on the face. */
  const commit = useCallback(
    (target: number) => {
      targetRef.current = target;
      animate();
      const f = FRAMES[mod(target, N)];
      if (f.id !== useTryOnStore.getState().selectedFrameId) setFrame(f.id);
    },
    [animate, setFrame],
  );

  // Follow the frame on the face (the assistant, or a commit above): turn
  // the short way round to it.
  useEffect(() => {
    const t = targetRef.current;
    if (mod(Math.round(t), N) === selIdx) return;
    const k = Math.round((t - selIdx) / N);
    targetRef.current = selIdx + k * N;
    animate();
  }, [selIdx, animate]);

  const L = useMemo(() => computeLayout(size.W, size.H), [size.W, size.H]);
  const slots = useMemo(() => (size.W > 0 ? slotsAt(L, pos) : []), [L, pos, size.W]);
  const stepPx = L.R * Math.sin(STEP);

  // Drag to turn: vertical movement, one frame per frame spacing.
  const drag = useRef<{ y: number; pos: number; id: number; active: boolean } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, pos: posRef.current, id: e.pointerId, active: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y;
    if (!d.active && Math.abs(dy) > 8) {
      d.active = true;
      draggingRef.current = true;
      discRef.current?.setPointerCapture(d.id);
    }
    if (d.active) {
      posRef.current = d.pos - dy / stepPx;
      setPos(posRef.current);
      invalidateRef.current?.();
    }
  };
  const onPointerEnd = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.active) return;
    draggingRef.current = false;
    commit(Math.round(posRef.current));
  };

  // Mouse wheel / trackpad: one frame per notch (non-passive, so the page doesn't scroll).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    let acc = 0;
    let lastStep = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      acc += e.deltaY;
      const now = performance.now();
      if (Math.abs(acc) < 40 || now - lastStep < 140) return;
      lastStep = now;
      const dir = Math.sign(acc);
      acc = 0;
      commit(Math.round(targetRef.current) + dir);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [commit]);

  const variants = frame.variants;
  const current = variants.find((v) => v.id === selectedVariantId) ?? variants[0];

  return (
    <div
      ref={boxRef}
      // Below the bottom controls (z-40) and click-through except for the
      // disc and its buttons: the pills/message box near it stay clickable.
      className="pointer-events-none absolute bottom-0 right-0 top-0 z-30 w-[clamp(21rem,38%,30rem)] touch-none select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      aria-label="फ्रेम चुनिए"
    >
      {size.W > 0 ? (
        <>
          {/* Dark frosted-glass disc: one consistent surface for the frames,
              whatever is behind the customer. Frosted-glass images (light
              haze in the middle, milky toward the rim) under a radial tint;
              a fine edge, a faint inner track for the colours. The disc is the drag surface — the
              panel around it lets clicks through to the controls below.
              Gradients use "closest-side" so 100 % is the rim (plain
              "circle" measures to the corner, 1.41 × the radius). */}
          <div
            ref={discRef}
            className="pointer-events-auto absolute rounded-full"
            style={{
              left: L.cx - L.R * DISC_DRAW,
              top: L.cy - L.R * DISC_DRAW,
              width: L.R * DISC_DRAW * 2,
              height: L.R * DISC_DRAW * 2,
              boxShadow: "0 12px 48px rgba(0,0,0,0.35)",
            }}
          >
            {[FROST_CENTRE_SRC, FROST_RIM_SRC].map((src) => (
              <div
                key={src}
                className="pointer-events-none absolute inset-0 rounded-full"
                style={{ backgroundImage: `url(${src})`, backgroundSize: "100% 100%" }}
                aria-hidden
              />
            ))}
            <div
              className="pointer-events-none absolute inset-0 rounded-full border border-white/15"
              style={{
                background: `radial-gradient(circle closest-side, rgba(14,14,18,${TINT_CENTRE}) 0%, rgba(14,14,18,${(TINT_CENTRE + TINT_RIM) / 2}) 55%, rgba(14,14,18,${TINT_RIM}) 100%)`,
                boxShadow: "inset 0 1px 0 rgba(255,255,255,0.08)",
              }}
            />
          </div>

          {/* The colour track: a faint circle the colours sit on. */}
          <div
            className="pointer-events-none absolute rounded-full border border-white/15"
            style={{ left: L.cx - L.r, top: L.cy - L.r, width: L.r * 2, height: L.r * 2 }}
            aria-hidden
          />

          {/* The selected frame's box rides with that frame: it comes in with
              the incoming frame and leaves (fading) with the outgoing one. */}
          {slots
            .filter((s) => s.sel > 0)
            .map((s) => (
              <div
                key={`box-${s.idx}`}
                className="pointer-events-none absolute rounded-2xl bg-white/90 shadow-[0_8px_28px_rgba(0,0,0,0.35)] ring-1 ring-white"
                style={{
                  // Same proportions as the frame inside it, grown with it.
                  left: s.x - (BOX_PAD + L.frameW / 2) * (1 + SELECT_GROW * s.sel),
                  top: s.y - (L.box.h * (1 + SELECT_GROW * s.sel)) / 2,
                  width: L.box.w * (1 + SELECT_GROW * s.sel),
                  height: L.box.h * (1 + SELECT_GROW * s.sel),
                  opacity: s.sel * s.opacity,
                }}
                aria-hidden
              />
            ))}

          {/* Under each frame: a soft spectacle shadow on the ground — white
              on the dark disc, black in the light box (same shape and spot),
              crossfading as a frame moves in or out of the box. Images from
              scripts/make-frame-shadow.py. Nothing behind the frames. */}
          {slots.map((s) =>
            (DISC_SHADOW_TONE === "dark"
              ? ([["dark", s.opacity]] as const)
              : ([
                  ["light", (1 - s.sel) * s.opacity],
                  ["dark", s.sel * s.opacity],
                ] as const)
            ).map(([tone, opacity]) =>
              opacity > 0 ? (
                // eslint-disable-next-line @next/next/no-img-element -- tiny static decoration, no optimisation needed
                <img
                  key={`shadow-${s.idx}-${tone}`}
                  src={`/images/frame-shadow-${tone}.png`}
                  alt=""
                  draggable={false}
                  className="pointer-events-none absolute select-none"
                  style={{
                // 800×380 image in the dial's three-quarter view (front band
                // lower left, arms to the upper right), with a 40 px margin for
                // the blur; the shape keeps its size and spot under the frame.
                left: s.x - (s.w * 400) / 720,
                top: s.y - s.w * 0.08 - (s.w * 40) / 720,
                width: (s.w * 800) / 720,
                height: (s.w * 380) / 720,
                opacity,
              }}
                  aria-hidden
                />
              ) : null,
            ),
          )}

          <PreviewCanvas
            L={L}
            slots={slots}
            selectedFrameId={selectedFrameId}
            selectedVariantId={selectedVariantId}
            invalidateRef={invalidateRef}
          />

          {/* Touch targets: frame + its name to the right; the selected one
              (inside the box) also shows its details under the name. */}
          {slots.map((s) => {
            const h = s.w * 0.5;
            const boxed = s.sel > 0.5;
            const isProduct = boxed && product && product.frameId === s.frame.id;
            const details = !boxed
              ? []
              : isProduct && product
                ? [
                    [product.brand, product.price != null ? formatRupees(product.price) : null]
                      .filter(Boolean)
                      .join(" · "),
                    [
                      product.shape ? SHAPE_LABEL[product.shape] ?? product.shape : null,
                      product.total ? `${(product.index ?? 0) + 1} / ${product.total}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
                  ].filter(Boolean)
                : [`${Math.round(s.frame.fit.frameWidthMm)} mm · ${s.frame.variants.length} रंग`];
            return (
              <button
                key={s.idx}
                type="button"
                onClick={() => commit(s.idx)}
                aria-pressed={s.centre}
                aria-label={s.frame.name}
                className="pointer-events-auto absolute flex items-center text-left"
                style={{
                  left: s.x - s.w / 2 - 4,
                  top: s.y - Math.max(h, 40) / 2 - 4,
                  height: Math.max(h, 40) + 8,
                  opacity: s.opacity,
                  columnGap: LABEL_GAP - 4,
                }}
              >
                <span className="relative block shrink-0" style={{ width: s.w + 8, height: h }}>
                  {s.glyph > 0 ? (
                    <FrameGlyph
                      shape={shapeOf(s.frame)}
                      color="rgba(255,255,255,0.85)"
                      className="absolute inset-x-1 top-1/2 h-[70%] -translate-y-1/2"
                    />
                  ) : null}
                </span>
                <span className="flex flex-col gap-0.5" style={{ width: L.labelW }}>
                  <span
                    className={`flex items-center gap-1.5 leading-tight ${
                      boxed ? "text-[15px] font-semibold text-zinc-900" : "text-xs font-medium text-white/85"
                    }`}
                  >
                    {/* Nothing before the name: it lines up with the details
                        under it. A liked frame's heart follows the name. */}
                    <span className="line-clamp-2">{isProduct && product ? product.name : s.frame.name}</span>
                    {liked.has(s.frame.id) ? (
                      <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 shrink-0 text-rose-500" fill="currentColor" aria-label="पसंद">
                        <path d={HEART} />
                      </svg>
                    ) : null}
                  </span>
                  {details.map((line, i) => (
                    <span key={i} className="truncate text-xs leading-snug text-zinc-500">
                      {line}
                    </span>
                  ))}
                </span>
              </button>
            );
          })}

          <ColourRing
            L={L}
            frameId={frame.id}
            frameIdx={selIdx}
            variants={variants}
            currentId={current.id}
            onPick={setVariant}
          />
        </>
      ) : null}
    </div>
  );
}
