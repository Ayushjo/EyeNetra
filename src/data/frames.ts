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
    frameWidthMm: number;
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
      frameWidthMm: 140,
      templeLengthMm: 140,
      bridgeWidthMm: 18,
      nosePadOffsetMm: 2,
      // Identity — upright GLB; Y-flip applied in normalize if temples face +Z.
      modelEuler: [0, 0, 0],
      scaleMul: 1.35,
      yOffsetFrac: 0.055,
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
      frameWidthMm: 132,
      templeLengthMm: 145,
      bridgeWidthMm: 20,
      nosePadOffsetMm: 3,
      modelEuler: [0, 0, 0],
      scaleMul: 1.3,
      yOffsetFrac: 0.055,
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
      frameWidthMm: 138,
      templeLengthMm: 130,
      bridgeWidthMm: 16,
      nosePadOffsetMm: 1,
      // Sport GLB is authored upside-down — Z=π at load; L/R undo in GlassesModel.
      modelEuler: [0, 0, Math.PI],
      scaleMul: 1.4,
      yOffsetFrac: 0.05,
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
      frameWidthMm: 136,
      templeLengthMm: 142,
      bridgeWidthMm: 19,
      nosePadOffsetMm: 2.5,
      modelEuler: [0, 0, 0],
      scaleMul: 1.32,
      yOffsetFrac: 0.055,
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
];

export function getFrameById(id: string): FrameSku {
  return FRAMES.find((f) => f.id === id) ?? FRAMES[0];
}
