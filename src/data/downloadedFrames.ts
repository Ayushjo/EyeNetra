// Third-party frame models added to the catalogue (17 Oct 2026).
// - Khronos Sunglasses: CC-BY 4.0, (c) Eric Chadwick / Darmstadt Graphics Group,
//   Khronos glTF Sample Assets — attribution required (public/models/khronos/LICENSE.txt).
//   Authored at true size (150 mm wide).
// - lp-*: CC0 "LowPoly Glasses Pack" by iPoly3D (opengameart.org), converted with
//   scripts/convert-obj-frames.mjs. No published dimensions: 140 mm assumed.
import type { FrameSku } from "./frames";

export const DOWNLOADED_FRAMES: FrameSku[] = [
  {
    "id": "khronos-sunglasses",
    "name": "Khronos Sunglasses",
    "glbPath": "/models/khronos/SunglassesKhronos.glb",
    "thumbnailColor": "#2b2b2b",
    "fit": {
      "lensMaterialNames": [
        "lens_interior",
        "lens_exterior"
      ],
      "frameWidthMm": 150,
      "templeLengthMm": 150,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "khronos-sunglasses-original",
        "name": "Original",
        "frameColor": "#ffffff",
        "lensColor": "#2a2f33",
        "lensOpacity": 0.45,
        "metalness": 0.1,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-1",
    "name": "Round Thin",
    "glbPath": "/models/lowpoly/lp-1.glb",
    "thumbnailColor": "#dfe636",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-1-original",
        "name": "Original",
        "frameColor": "#dfe636",
        "lensColor": "#e6e6e6",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-1-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-2",
    "name": "Aviator Classic",
    "glbPath": "/models/lowpoly/lp-2.glb",
    "thumbnailColor": "#939393",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-2-original",
        "name": "Original",
        "frameColor": "#939393",
        "lensColor": "#4c51e6",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-2-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-3",
    "name": "Round Metal Gold",
    "glbPath": "/models/lowpoly/lp-3.glb",
    "thumbnailColor": "#e6e6e6",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-3-original",
        "name": "Original",
        "frameColor": "#e6e6e6",
        "lensColor": "#4c51e6",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-3-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-4",
    "name": "Aviator Double Bridge",
    "glbPath": "/models/lowpoly/lp-4.glb",
    "thumbnailColor": "#e646d6",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-4-original",
        "name": "Original",
        "frameColor": "#e646d6",
        "lensColor": "#3e3e3e",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-4-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-5",
    "name": "Round Bold",
    "glbPath": "/models/lowpoly/lp-5.glb",
    "thumbnailColor": "#416be6",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-5-original",
        "name": "Original",
        "frameColor": "#416be6",
        "lensColor": "#7bbbe6",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-5-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-6",
    "name": "Square Bold",
    "glbPath": "/models/lowpoly/lp-6.glb",
    "thumbnailColor": "#58e664",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-6-original",
        "name": "Original",
        "frameColor": "#58e664",
        "lensColor": "#4c51e6",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-6-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-8",
    "name": "Rectangle Soft",
    "glbPath": "/models/lowpoly/lp-8.glb",
    "thumbnailColor": "#e6e6e6",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-8-original",
        "name": "Original",
        "frameColor": "#e6e6e6",
        "lensColor": "#dfe636",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-8-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-9",
    "name": "Round Pastel",
    "glbPath": "/models/lowpoly/lp-9.glb",
    "thumbnailColor": "#ff83bf",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-9-original",
        "name": "Original",
        "frameColor": "#ff83bf",
        "lensColor": "#86e6a6",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-9-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-10",
    "name": "Rectangle Clear",
    "glbPath": "/models/lowpoly/lp-10.glb",
    "thumbnailColor": "#e6e6e6",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-10-original",
        "name": "Original",
        "frameColor": "#e6e6e6",
        "lensColor": "#4ee69c",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-10-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-13",
    "name": "Cat-Eye Sharp",
    "glbPath": "/models/lowpoly/lp-13.glb",
    "thumbnailColor": "#e62927",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-13-original",
        "name": "Original",
        "frameColor": "#e62927",
        "lensColor": "#e67988",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-13-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-15",
    "name": "Oval",
    "glbPath": "/models/lowpoly/lp-15.glb",
    "thumbnailColor": "#ffffff",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-15-original",
        "name": "Original",
        "frameColor": "#ffffff",
        "lensColor": "#e66031",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-15-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-17",
    "name": "Cat-Eye Oversize",
    "glbPath": "/models/lowpoly/lp-17.glb",
    "thumbnailColor": "#3038e6",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-17-original",
        "name": "Original",
        "frameColor": "#3038e6",
        "lensColor": "#3cbfe6",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-17-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-19",
    "name": "Square Retro",
    "glbPath": "/models/lowpoly/lp-19.glb",
    "thumbnailColor": "#f3f3f3",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-19-original",
        "name": "Original",
        "frameColor": "#f3f3f3",
        "lensColor": "#e63758",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-19-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-20",
    "name": "Rectangle Wide",
    "glbPath": "/models/lowpoly/lp-20.glb",
    "thumbnailColor": "#e6e6e6",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-20-original",
        "name": "Original",
        "frameColor": "#e6e6e6",
        "lensColor": "#c766a7",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-20-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-23",
    "name": "Cat-Eye Sport",
    "glbPath": "/models/lowpoly/lp-23.glb",
    "thumbnailColor": "#303030",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-23-original",
        "name": "Original",
        "frameColor": "#303030",
        "lensColor": "#0fe600",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-23-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-26",
    "name": "Round Keyhole",
    "glbPath": "/models/lowpoly/lp-26.glb",
    "thumbnailColor": "#fe6845",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-26-original",
        "name": "Original",
        "frameColor": "#fe6845",
        "lensColor": "#303030",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-26-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-28",
    "name": "Rectangle Slim",
    "glbPath": "/models/lowpoly/lp-28.glb",
    "thumbnailColor": "#e6e6e6",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-28-original",
        "name": "Original",
        "frameColor": "#e6e6e6",
        "lensColor": "#9b9b9b",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-28-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  },
  {
    "id": "lp-29",
    "name": "Narrow Rectangle",
    "glbPath": "/models/lowpoly/lp-29.glb",
    "thumbnailColor": "#4fe6cb",
    "fit": {
      "lensMaterialNames": [
        "Lens"
      ],
      "frameWidthMm": 140,
      "templeLengthMm": 145,
      "bridgeWidthMm": 18,
      "nosePadOffsetMm": 2,
      "modelEuler": [
        0,
        0,
        0
      ],
      "scaleMul": 1.3,
      "yOffsetFrac": 0.055,
      "perspYOffsetCm": 0,
      "perspScaleTune": 1.0
    },
    "variants": [
      {
        "id": "lp-29-original",
        "name": "Original",
        "frameColor": "#4fe6cb",
        "lensColor": "#4f4f4f",
        "lensOpacity": 0.4,
        "metalness": 0.05,
        "roughness": 0.45
      },
      {
        "id": "lp-29-black",
        "name": "Black",
        "frameColor": "#141414",
        "lensColor": "#3a3f44",
        "lensOpacity": 0.55,
        "metalness": 0.05,
        "roughness": 0.35
      }
    ]
  }
];
