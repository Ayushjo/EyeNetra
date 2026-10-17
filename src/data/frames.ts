import { REAL_FRAMES } from "./realFrames.generated";
import { DOWNLOADED_FRAMES } from "./downloadedFrames";

export type FrameVariant = {
  id: string;
  name: string;
  /** Hex tint applied to acetate / frame meshes. */
  frameColor: string;
  /** Lens tint as CSS hex; alpha controlled separately. */
  lensColor: string;
  lensOpacity: number;
  metalness: number;
  roughness: number;
};

export type FrameSku = {
  id: string;
  name: string;
  glbPath: string;
  thumbnailColor: string;
  /** Fit metadata in millimeters — used by useFitEngine for non-uniform scaling. */
  fit: {
    /** Explicit GLB material roles; add lens material names when importing a SKU. */
    lensMaterialNames?: string[];
    frameWidthMm: number;
    /**
     * Outer lens edge to outer lens edge (2×A-size + DBL from the maker's
     * spec, mm). When present it drives the physical scale instead of
     * frameWidthMm/bbox, which includes end-piece flare.
     */
    lensSpanMm?: number;
    templeLengthMm: number;
    bridgeWidthMm: number;
    nosePadOffsetMm: number;
    /**
     * Local Euler correction (radians, XYZ) applied to the GLB before normalize.
     * Many product GLBs are exported upside-down or facing -Z.
     */
    modelEuler: [number, number, number];
    /** Extra uniform scale multiplier on top of eye-span fit (1 = default). */
    scaleMul: number;
    /** Vertical sit as fraction of scale (positive = lower on face). */
    yOffsetFrac: number;
    /**
     * Perspective-path fit overrides (cm). Each GLB is authored/centered
     * differently, so these bake the correct sit per model. The global dev
     * sliders add a delta on top of these for live tuning.
     */
    perspYOffsetCm?: number;
    perspZOffsetCm?: number;
    perspScaleTune?: number;
    /**
     * Manual nose-pad contact point (normalized width-1 model units) when the
     * automatic bridge scan misreads an odd GLB.
     */
    bridgeLocalOverride?: [number, number, number];
    /**
     * Per-product frame tilt in degrees (negative = temples slope down).
     * Default −3.5° — Meta's try-on default (GLASS_OFFSETS.rotationX).
     */
    pantoDeg?: number;
  };
  variants: FrameVariant[];
};


export const FRAMES: FrameSku[] = [
  {
    id: "aviator",
    name: "Aviator",
    glbPath: "/models/aviator-sunglasses.glb",
    thumbnailColor: "#1a1a1a",
    fit: {
      lensMaterialNames: ["Glass_tinted"],
      frameWidthMm: 140,
      templeLengthMm: 140,
      bridgeWidthMm: 18,
      nosePadOffsetMm: 2,
      // Identity — upright GLB; Y-flip applied in normalize if temples face +Z.
      modelEuler: [0, 0, 0],
      scaleMul: 1.35,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "aviator-black",
        name: "Black",
        frameColor: "#1a1a1a",
        lensColor: "#1a2030",
        lensOpacity: 0.55,
        metalness: 0.85,
        roughness: 0.25,
      },
      {
        id: "aviator-gold",
        name: "Gold",
        frameColor: "#c9a227",
        lensColor: "#3a2818",
        lensOpacity: 0.45,
        metalness: 0.95,
        roughness: 0.15,
      },
      {
        id: "aviator-silver",
        name: "Silver",
        frameColor: "#c0c4c8",
        lensColor: "#1a2838",
        lensOpacity: 0.5,
        metalness: 0.9,
        roughness: 0.18,
      },
    ],
  },
  {
    id: "round",
    name: "Round Acetate",
    glbPath: "/models/glasses-round-frame.glb",
    thumbnailColor: "#2c1810",
    fit: {
      lensMaterialNames: ["000_Glass"],
      frameWidthMm: 132,
      templeLengthMm: 145,
      bridgeWidthMm: 20,
      nosePadOffsetMm: 3,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "round-tortoise",
        name: "Tortoise",
        frameColor: "#5c3317",
        lensColor: "#e8f0f8",
        lensOpacity: 0.18,
        metalness: 0.05,
        roughness: 0.35,
      },
      {
        id: "round-black",
        name: "Matte Black",
        frameColor: "#111111",
        lensColor: "#e8f0f8",
        lensOpacity: 0.15,
        metalness: 0.08,
        roughness: 0.45,
      },
      {
        id: "round-crystal",
        name: "Crystal",
        frameColor: "#d8d4cc",
        lensColor: "#e8f0f8",
        lensOpacity: 0.12,
        metalness: 0.1,
        roughness: 0.3,
      },
    ],
  },
  {
    id: "sport",
    name: "Sport B307",
    glbPath: "/models/sport-glasses-b307.glb",
    thumbnailColor: "#0a1628",
    fit: {
      lensMaterialNames: ["B307_REALphong1SG2"],
      frameWidthMm: 138,
      templeLengthMm: 130,
      bridgeWidthMm: 16,
      nosePadOffsetMm: 1,
      // GLB already carries its OBJ-to-glTF axis conversion. Keep it upright.
      modelEuler: [0, 0, 0],
      scaleMul: 1.4,
      yOffsetFrac: 0.05,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "sport-navy",
        name: "Navy",
        frameColor: "#0a1628",
        lensColor: "#0a1828",
        lensOpacity: 0.65,
        metalness: 0.15,
        roughness: 0.4,
      },
      {
        id: "sport-red",
        name: "Racing Red",
        frameColor: "#8b1520",
        lensColor: "#1a1010",
        lensOpacity: 0.6,
        metalness: 0.2,
        roughness: 0.35,
      },
      {
        id: "sport-white",
        name: "White",
        frameColor: "#f0f0f0",
        lensColor: "#102030",
        lensOpacity: 0.55,
        metalness: 0.12,
        roughness: 0.38,
      },
    ],
  },
  {
    id: "ai-frames",
    name: "Studio Frames",
    glbPath: "/models/ai-generated-frames.glb",
    thumbnailColor: "#3d2a1a",
    fit: {
      lensMaterialNames: ["Material_0.001"],
      frameWidthMm: 136,
      templeLengthMm: 142,
      bridgeWidthMm: 19,
      nosePadOffsetMm: 2.5,
      modelEuler: [0, 0, 0],
      scaleMul: 1.32,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "ai-brown",
        name: "Brown",
        frameColor: "#3d2a1a",
        lensColor: "#e8f0f8",
        lensOpacity: 0.2,
        metalness: 0.06,
        roughness: 0.4,
      },
      {
        id: "ai-black",
        name: "Black",
        frameColor: "#151515",
        lensColor: "#e8f0f8",
        lensOpacity: 0.18,
        metalness: 0.08,
        roughness: 0.42,
      },
    ],
  },
  // Realistic everyday styles (scripts/generate-real-frames.mjs).
  ...REAL_FRAMES,
  // Third-party models (Khronos CC-BY 4.0, iPoly3D CC0).
  ...DOWNLOADED_FRAMES,
  {
    id: "p-round-s",
    name: "Param Round S",
    glbPath: "/models/param/p-round-s.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 44×44 mm, round.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 122,
      lensSpanMm: 114.0,
      templeLengthMm: 140,
      bridgeWidthMm: 21,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-round-s-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
  {
    id: "p-round-l",
    name: "Param Round L",
    glbPath: "/models/param/p-round-l.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 50×48 mm, round.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 136,
      lensSpanMm: 128,
      templeLengthMm: 145,
      bridgeWidthMm: 22,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-round-l-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
  {
    id: "p-rect-s",
    name: "Param Rect S",
    glbPath: "/models/param/p-rect-s.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 50×32 mm, rect.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 130,
      lensSpanMm: 122,
      templeLengthMm: 140,
      bridgeWidthMm: 18,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-rect-s-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
  {
    id: "p-rect-l",
    name: "Param Rect L",
    glbPath: "/models/param/p-rect-l.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 56×38 mm, rect.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 142,
      lensSpanMm: 134.0,
      templeLengthMm: 145,
      bridgeWidthMm: 17,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-rect-l-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
  {
    id: "p-square",
    name: "Param Square",
    glbPath: "/models/param/p-square.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 52×44 mm, square.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 138,
      lensSpanMm: 130,
      templeLengthMm: 145,
      bridgeWidthMm: 20,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-square-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
  {
    id: "p-wayfarer",
    name: "Param Wayfarer",
    glbPath: "/models/param/p-wayfarer.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 52×42 mm, wayfarer.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 139,
      lensSpanMm: 131.0,
      templeLengthMm: 145,
      bridgeWidthMm: 20,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-wayfarer-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
  {
    id: "p-aviator",
    name: "Param Aviator",
    glbPath: "/models/param/p-aviator.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 58×50 mm, aviator.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 140.4,
      lensSpanMm: 132.4,
      templeLengthMm: 140,
      bridgeWidthMm: 14,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-aviator-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
  {
    id: "p-cateye",
    name: "Param Cat-Eye",
    glbPath: "/models/param/p-cateye.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 52×40 mm, cateye.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 136,
      lensSpanMm: 128,
      templeLengthMm: 140,
      bridgeWidthMm: 18,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-cateye-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
  {
    id: "p-oval",
    name: "Param Oval",
    glbPath: "/models/param/p-oval.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 50×36 mm, oval.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 131,
      lensSpanMm: 123,
      templeLengthMm: 142,
      bridgeWidthMm: 19,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-oval-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
  {
    id: "p-shield",
    name: "Param Shield",
    glbPath: "/models/param/p-shield.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 62×44 mm, shield.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 148,
      lensSpanMm: 140,
      templeLengthMm: 130,
      bridgeWidthMm: 12,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-shield-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
  {
    id: "p-narrow",
    name: "Param Narrow",
    glbPath: "/models/param/p-narrow.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 46×28 mm, rect.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 124,
      lensSpanMm: 116,
      templeLengthMm: 138,
      bridgeWidthMm: 20,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-narrow-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
  {
    id: "p-oversize",
    name: "Param Oversize",
    glbPath: "/models/param/p-oversize.glb",
    thumbnailColor: "#2a2a2a",
    // Parametric measurement rig (scripts/generate-param-frames.mjs):
    // exact dims, not a product. Lens 58×50 mm, square.
    fit: {
      lensMaterialNames: ["Lens"],
      frameWidthMm: 148,
      lensSpanMm: 140,
      templeLengthMm: 150,
      bridgeWidthMm: 16,
      nosePadOffsetMm: 2,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
      perspYOffsetCm: 0,
      perspScaleTune: 1.0,
    },
    variants: [
      {
        id: "p-oversize-black",
        name: "Matte Black",
        frameColor: "#1c1c1c",
        lensColor: "#8a96a3",
        lensOpacity: 0.3,
        metalness: 0.1,
        roughness: 0.5,
      },
    ],
  },
];

export function getFrameById(id: string): FrameSku {
  return FRAMES.find((f) => f.id === id) ?? FRAMES[0];
}
